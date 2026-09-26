import {
  BUNDLE_MAX_SOL,
  BUNDLE_PRESETS_SOL,
  DEV_BUY_SOL,
  HOUR_MS,
  RATE_LIMITS,
  SIM_DURATION_SEC,
  SIM_SEED_MAX,
  simConfigSchema,
} from "@launchbot/shared";
import { resetRateLimits } from "@launchbot/shared/server";
import {
  assertSimConfig,
  createSimulation,
  FALLBACK_CURVE_PARAMS,
  isValidSeed,
  presetForAmount,
} from "@launchbot/sim-engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSimulations, TEST_USER } from "../test-harness.js";
import { buildSimConfig, createSimulationService, drawSeed } from "./simulation.js";

const T0 = Date.parse("2026-09-23T12:00:00Z");

describe("buildSimConfig", () => {
  const build = (bundleSol: number, solUsdPrice: number | null = 150) =>
    buildSimConfig({
      seed: 42,
      devBuySol: 1,
      bundleSol,
      curve: FALLBACK_CURVE_PARAMS,
      solUsdPrice,
    });

  it("buys 1 SOL then the bundle, whose preset it takes, for the 3 min of §6 at the price", () => {
    for (const sol of [3, 5, 10, 7]) {
      const config = build(sol);
      expect(config.durationSec).toBe(SIM_DURATION_SEC);
      expect(config.preset).toEqual(presetForAmount(sol));
      expect(config).toMatchObject({ devBuySol: 1, bundleSol: sol });
    }
    expect(build(3, null).solUsdPrice).toBeNull();
  });

  it("is valid for the engine and for the schema, before and after a JSON round trip", () => {
    const config = build(5);
    const stored: unknown = JSON.parse(JSON.stringify(config));

    expect(() => assertSimConfig(config)).not.toThrow();
    expect(simConfigSchema.parse(stored)).toEqual(config);
    expect(() => createSimulation(simConfigSchema.parse(stored)).step(1)).not.toThrow();
  });
});

describe("acceptance (§15, D22): no sale of the dev, the price ends above the opening buys", () => {
  // The model of 25/09/2026: 1 SOL of dev buy then the bundle, the preset of the bundle, the
  // config the bot really builds. Presets 3, 5 and 10, and the top of Custom (20 SOL).
  it.each([...BUNDLE_PRESETS_SOL, BUNDLE_MAX_SOL])(
    "ends above the price after 1 SOL + a %s SOL bundle for seeds 1 to 1 000",
    (bundleSol) => {
      let above = 0;
      for (let seed = 1; seed <= 1_000; seed += 1) {
        const sim = createSimulation(
          buildSimConfig({
            seed,
            devBuySol: DEV_BUY_SOL,
            bundleSol,
            curve: FALLBACK_CURVE_PARAMS,
            solUsdPrice: 150,
          }),
        );
        const [devBuy, bundle] = sim.openingBuys();
        expect([devBuy.sol, bundle?.sol]).toEqual([DEV_BUY_SOL, bundleSol]);
        sim.step(SIM_DURATION_SEC);
        if (sim.state().price > (bundle?.price ?? Infinity)) above += 1;
      }
      expect(above).toBe(1_000);
    },
  );
});

describe("drawSeed", () => {
  it("draws a valid seed below 2^31", () => {
    for (let i = 0; i < 1_000; i += 1) {
      const seed = drawSeed();
      expect(isValidSeed(seed)).toBe(true);
      expect(seed).toBeLessThanOrEqual(SIM_SEED_MAX);
    }
    expect(SIM_SEED_MAX).toBe(2_147_483_647);
  });
});

describe("createSimulationService", () => {
  beforeEach(resetRateLimits);

  function harness(options: { price?: number | null } = {}) {
    let time = T0;
    let nextSeed = 1000;
    const store = fakeSimulations({ now: () => time });
    const getCurveParams = vi.fn().mockResolvedValue({
      curve: FALLBACK_CURVE_PARAMS,
      source: "fallback",
      fetchedAt: new Date(T0),
    });
    const service = createSimulationService({
      store,
      data: {
        getCurveParams,
        getSolUsdPrice: () => Promise.resolve(options.price === undefined ? 150 : options.price),
      },
      now: () => time,
      seed: () => nextSeed++,
    });
    const prepare = (bundleSol: number, draftId = "d1") =>
      service.prepare({ userId: TEST_USER.id, telegramId: 777, draft: { id: draftId }, bundleSol });
    const prepareLaunch = (bundleSol: number) =>
      service.prepareLaunch({ userId: TEST_USER.id, draft: { id: "d1" }, bundleSol });
    return {
      prepare,
      prepareLaunch,
      store,
      getCurveParams,
      at: (ms: number) => void (time = T0 + ms),
    };
  }

  it("creates a Simulation with the seed, the curve and the price of the moment", async () => {
    const { prepare, store } = harness();

    const result = await prepare(5);

    expect(result).toMatchObject({ kind: "ok", simId: "s1" });
    if (result.kind !== "ok") return;
    expect(result.config).toEqual({
      seed: 1000,
      devBuySol: 1,
      bundleSol: 5,
      durationSec: SIM_DURATION_SEC,
      curve: FALLBACK_CURVE_PARAMS,
      preset: presetForAmount(5),
      solUsdPrice: 150,
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: TEST_USER.id,
      tokenDraftId: "d1",
      devBuySol: "1",
      bundleSol: "5",
      seed: 1000,
      params: result.config,
    });
  });

  it("shows the same Simulation again for the same draft and bundle, within the hour", async () => {
    const { prepare, store, at } = harness();

    const first = await prepare(5);
    at(HOUR_MS - 1);
    const again = await prepare(5);

    expect(again).toMatchObject({ kind: "ok", simId: "s1" });
    expect(again.kind === "ok" && first.kind === "ok" && again.config).toEqual(
      first.kind === "ok" ? first.config : undefined,
    );
    expect(store.rows).toHaveLength(1);
  });

  it("creates a new one after an hour, for another bundle, or for a copied draft", async () => {
    const { prepare, store, at } = harness();

    await prepare(5);
    expect(await prepare(3)).toMatchObject({ simId: "s2" });
    expect(await prepare(5, "d2")).toMatchObject({ simId: "s3" });
    at(HOUR_MS);
    expect(await prepare(5)).toMatchObject({ simId: "s4" });
    expect(store.rows.map((row) => row.seed)).toEqual([1000, 1001, 1002, 1003]);
  });

  it("refuses a creation over the limit, without a row, and still reuses", async () => {
    const { prepare, store } = harness();
    const { limit } = RATE_LIMITS.simulation;
    // One creation per distinct Custom amount: 3, 3.001, 3.002…
    for (let i = 0; i < limit; i += 1) expect((await prepare(3 + i / 1000)).kind).toBe("ok");

    const refused = await prepare(5);

    expect(refused.kind).toBe("rate_limited");
    expect(store.rows).toHaveLength(limit);
    expect(await prepare(3)).toMatchObject({ kind: "ok", simId: "s1" });
  });

  it("gives each launch its own chart, from a fresh seed, outside the limit of creations", async () => {
    const { prepare, prepareLaunch, store } = harness();
    const { limit } = RATE_LIMITS.simulation;
    for (let i = 0; i < limit; i += 1) await prepare(3 + i / 1000);

    const first = await prepareLaunch(3);
    const second = await prepareLaunch(3);

    expect(first).toMatchObject({ simId: `s${limit + 1}`, config: { devBuySol: 1, bundleSol: 3 } });
    expect(second.simId).toBe(`s${limit + 2}`);
    expect(second.config.seed).not.toBe(first.config.seed);
    expect(store.rows).toHaveLength(limit + 2);
  });

  it("stores null as the price when it is unknown", async () => {
    const { prepare } = harness({ price: null });

    const result = await prepare(3);

    expect(result.kind === "ok" && result.config.solUsdPrice).toBeNull();
  });
});
