import { describe, expect, it } from "vitest";
import { FALLBACK_CURVE_PARAMS } from "./curve.js";
import { SimulationEndedError } from "./errors.js";
import { presetForAmount } from "./presets.js";
import { assertSimConfig, createSimulation, DEV_DUMP_PANIC_SHARE } from "./simulation.js";
import type { SimulationRun } from "./simulation.js";
import { expectClose, simConfig as config } from "./test-helpers.js";
import type { SimConfig, TradeEvent } from "./types.js";

/** Runs to the end by `dtSec` steps, with an optional sell at a simulated instant. */
function run(
  sim: SimulationRun,
  dtSec: number,
  sell?: { at: number; fraction: number },
): TradeEvent[] {
  const events: TradeEvent[] = [];
  let sold = false;
  while (sim.endReason() === null) {
    if (sell !== undefined && !sold && sim.time() >= sell.at) {
      const sale = sim.sellDev(sell.fraction);
      events.push(sale.event, ...sale.panic);
      sold = true;
      if (sim.endReason() !== null) break;
    }
    events.push(...sim.step(dtSec));
  }
  return events;
}

describe("createSimulation", () => {
  it("replays the same run from the same config, whatever the slicing", () => {
    const whole = createSimulation(config());
    const wholeEvents = whole.step(180);
    expect(wholeEvents.length).toBeGreaterThan(50);

    // Absolute instants, as the runner of the chat calls it: the same events, an exact clock.
    const byInstant = createSimulation(config());
    const events: TradeEvent[] = [];
    for (let ms = 3007; byInstant.endReason() === null; ms += 3007) {
      events.push(...byInstant.advanceTo(Math.min(180, ms / 1000)));
    }
    expect(events).toEqual(wholeEvents);
    expect(byInstant.time()).toBe(180);
    expect(() => byInstant.advanceTo(179)).toThrow(RangeError);

    const bySecond = createSimulation(config());
    expect(run(bySecond, 1)).toEqual(wholeEvents);
    expect(bySecond.state()).toEqual(whole.state());
    expect(bySecond.position()).toEqual(whole.position());
    expect(bySecond.topHolders(10)).toEqual(whole.topHolders(10));

    const by64 = createSimulation(config());
    expect(run(by64, 1 / 64)).toEqual(wholeEvents);
    expect(by64.time()).toBe(180);

    expect(createSimulation(config({ seed: 43 })).step(180)).not.toEqual(wholeEvents);
  });

  it("replays the same trades with a sell of the dev at the same simulated instant", () => {
    const a = run(createSimulation(config()), 1, { at: 30, fraction: 0.5 });
    const b = run(createSimulation(config()), 1 / 64, { at: 30, fraction: 0.5 });
    expect(a).toEqual(b);
    expect(a.filter((e) => e.trader === "dev")).toHaveLength(1);
  });

  it("replays identically from a config passed through JSON", () => {
    const original = config();
    const parsed = JSON.parse(JSON.stringify(original)) as SimConfig;
    expect(createSimulation(parsed).step(180)).toEqual(createSimulation(original).step(180));
  });

  it("buys for the dev at t = 0 before any simulated trade, without mutating the config", () => {
    const input = config();
    const sim = createSimulation(input);
    const [devBuy] = sim.openingBuys();
    expect(devBuy).toMatchObject({ t: 0, side: "buy", trader: "dev", sol: 3 });
    expectClose(devBuy.tokens, 96_657_870.79);
    expect(sim.time()).toBe(0);
    expect(sim.endReason()).toBeNull();
    const events = sim.step(180);
    expect(events.every((e) => e.t > 0 && e.trader !== "dev")).toBe(true);
    expect(input).toEqual(config());
    expect(sim.position()).toMatchObject({ solIn: 3, solOut: 0 });
  });

  it("a bundle (25/09/2026): the second buy of the dev at t = 0, before any trader", () => {
    const sim = createSimulation(
      config({ devBuySol: 1, bundleSol: 3, preset: presetForAmount(3) }),
    );
    const [devBuy, bundle, ...rest] = sim.openingBuys();
    expect(rest).toEqual([]);
    expect(devBuy).toMatchObject({ t: 0, side: "buy", trader: "dev", sol: 1 });
    expect(bundle).toMatchObject({ t: 0, side: "buy", trader: "dev", sol: 3 });
    expect(bundle?.price).toBeGreaterThan(devBuy?.price ?? Infinity);

    // One wallet, one position: both buys, as one buy of 4 SOL would give (fees are linear).
    const single = createSimulation(config({ devBuySol: 4, preset: presetForAmount(3) }));
    expectClose(sim.position().tokens, single.position().tokens);
    expect(sim.position()).toMatchObject({ solIn: 4, solOut: 0 });
    expectClose(sim.state().price, single.state().price);
    expect(sim.step(180).every((e) => e.t > 0 && e.trader !== "dev")).toBe(true);
  });

  it("without a bundle, the dev buy alone: the runs made before the bundle replay the same", () => {
    const sim = createSimulation(config());
    expect(sim.openingBuys()).toHaveLength(1);
    // A dev buy that completes the curve leaves nothing to bundle.
    const tiny = { ...FALLBACK_CURVE_PARAMS, realTokens: 10_000_000 };
    const complete = createSimulation(config({ devBuySol: 20, bundleSol: 3, curve: tiny }));
    expect(complete.openingBuys()).toHaveLength(1);
    expect(complete.endReason()).toBe("curve_complete");
  });

  it("sells the dev's tokens through the curve: the vectors of the card", () => {
    const sim = createSimulation(config());
    const { event, panic } = sim.sellDev(1);
    expect(event).toMatchObject({ t: 0, side: "sell", trader: "dev" });
    // Nobody else holds anything at t = 0: no panic to speak of.
    expect(panic).toEqual([]);
    expectClose(event.sol, 2.9403);
    expectClose(event.tokens, 96_657_870.79);
    const position = sim.position();
    expect(position.tokens).toBe(0);
    expectClose(position.solOut, 2.9403);
    expectClose(position.pnlSol, -0.0597, 1e-6);
    expectClose(position.pnlPct, -1.99, 1e-6);
    expect(position.valueIfSoldNow).toBe(0);
    const state = sim.state();
    expectClose(state.x, 30);
    expectClose(state.y, 1_073_000_000);
    expect(sim.endReason()).toBe("position_closed");
    expect(sim.time()).toBe(0);

    const halves = createSimulation(config());
    const first = halves.sellDev(0.5).event;
    const second = halves.sellDev(1).event;
    expectClose(first.sol + second.sol, 2.9403);
    expect(halves.endReason()).toBe("position_closed");
  });

  it("values the position by the curve, never by price × tokens", () => {
    const sim = createSimulation(config());
    const position = sim.position();
    expectClose(position.valueIfSoldNow, 2.9403);
    expect(position.valueIfSoldNow).toBeLessThan(sim.state().price * position.tokens);
    expectClose(sim.state().price * position.tokens, 3.264, 1e-3);
    expectClose(position.pnlSol, position.solOut + position.valueIfSoldNow - position.solIn, 1e-12);
  });

  it("keeps pnlSol = solOut + valueIfSoldNow − solIn after every step of a full run", () => {
    const sim = createSimulation(config({ seed: 7 }));
    while (sim.endReason() === null) {
      sim.step(2.5);
      if (sim.time() >= 60 && sim.position().tokens > 0 && sim.position().solOut === 0)
        sim.sellDev(0.25);
      const p = sim.position();
      expect(Math.abs(p.pnlSol - (p.solOut + p.valueIfSoldNow - p.solIn))).toBeLessThanOrEqual(
        1e-12,
      );
      expect(Math.abs(p.pnlPct - (p.pnlSol / p.solIn) * 100)).toBeLessThanOrEqual(1e-9);
    }
    expect(sim.position().solOut).toBeGreaterThan(0);
  });

  it("ends on timeout at 180 s, then returns nothing and freezes the clock", () => {
    const sim = createSimulation(config());
    for (let i = 0; i < 18; i += 1) sim.step(10);
    expect(sim.endReason()).toBe("timeout");
    expect(sim.time()).toBe(180);
    expect(sim.step(10)).toEqual([]);
    expect(sim.time()).toBe(180);
    expect(() => sim.sellDev(1)).toThrow(SimulationEndedError);
    const state = sim.state();
    sim.step(1);
    expect(sim.state()).toEqual(state);
  });

  it("snaps the clock drift of non-dyadic steps: 11 250 × step(0.016) ends on the last frame", () => {
    const sim = createSimulation(config());
    for (let i = 0; i < 11_250; i += 1) sim.step(0.016);
    expect(sim.endReason()).toBe("timeout");
    expect(sim.time()).toBe(180);
  });

  it("makes the holders dump 90% of their tokens on a Sell 100%: the market cap falls back near the launch", () => {
    const sim = createSimulation(config());
    sim.step(90);
    const before = sim.state();
    // The traders only: neither the dev nor the bonding curve itself.
    const holdersBefore = sim.topHolders(1000).filter((h) => h.label === undefined);
    const { event, panic } = sim.sellDev(1);

    expect(event.trader).toBe("dev");
    expect(panic.length).toBe(holdersBefore.length);
    expect(panic.every((e) => e.t === 90 && e.side === "sell" && e.trader !== "dev")).toBe(true);
    // The biggest holder first, each selling 90 % of what it held.
    const tokensSold = panic.map((e) => e.tokens);
    expect(tokensSold).toEqual([...tokensSold].sort((a, b) => b - a));
    expectClose(tokensSold[0]!, holdersBefore[0]!.tokens * DEV_DUMP_PANIC_SHARE, 1e-9);
    // Each event carries the price after it: the curve only falls during the dump.
    for (let i = 1; i < panic.length; i += 1)
      expect(panic[i]!.price).toBeLessThan(panic[i - 1]!.price);
    const after = sim.state();
    const launchPrice = FALLBACK_CURVE_PARAMS.virtualSol / FALLBACK_CURVE_PARAMS.virtualTokens;
    expect(after.price).toBeLessThan(before.price * 0.7);
    expect(after.price).toBeGreaterThan(launchPrice);
    expect(after.price).toBeLessThan(launchPrice * 1.15);
    expect(sim.endReason()).toBe("position_closed");
    // A partial sale never triggers it.
    const partial = createSimulation(config());
    partial.step(90);
    expect(partial.sellDev(0.5).panic).toEqual([]);
  });

  it("ends on position_closed when the dev sells everything", () => {
    const sim = createSimulation(config());
    for (let i = 0; i < 42; i += 1) sim.step(1);
    sim.sellDev(0.25);
    expect(sim.endReason()).toBeNull();
    sim.sellDev(1);
    expect(sim.endReason()).toBe("position_closed");
    expect(sim.time()).toBe(42);
    expect(() => sim.sellDev(0.5)).toThrow(SimulationEndedError);
    expect(sim.step(1)).toEqual([]);
    expect(sim.topHolders(10).some((h) => h.label === "dev")).toBe(false);
  });

  it("ends on curve_complete when a buy caps the curve, at the instant of that buy", () => {
    const small = { ...FALLBACK_CURVE_PARAMS, realTokens: 150_000_000 };
    const sim = createSimulation(config({ devBuySol: 3, curve: small }));
    const events = run(sim, 1);
    expect(sim.endReason()).toBe("curve_complete");
    const last = events[events.length - 1];
    expect(last?.side).toBe("buy");
    expect(sim.time()).toBe(last?.t);
    expect(sim.time()).toBeLessThan(180);
    expect(sim.state().realTokens).toBe(0);
    expect(sim.step(1)).toEqual([]);
  });

  it("ends on curve_complete at t = 0 when the dev buy itself caps the curve", () => {
    const tiny = { ...FALLBACK_CURVE_PARAMS, realTokens: 10_000_000 };
    const sim = createSimulation(config({ devBuySol: 20, curve: tiny }));
    expect(sim.endReason()).toBe("curve_complete");
    expect(sim.time()).toBe(0);
    expect(sim.openingBuys()[0].tokens).toBe(10_000_000);
    expect(sim.openingBuys()[0].sol).toBeLessThan(20);
    expect(sim.step(10)).toEqual([]);
    expect(() => sim.sellDev(1)).toThrow(SimulationEndedError);
    expect(sim.topHolders(5).map((h) => h.address)).toEqual(["bonding_curve", "dev"]);
  });

  it("lists the top holders with the bonding curve and the dev, shares summing to 100 %", () => {
    const sim = createSimulation(config());
    const atStart = sim.topHolders(10);
    expect(atStart.map((h) => h.address)).toEqual(["bonding_curve", "dev"]);
    expectClose(atStart[0]?.pctSupply ?? 0, 90.334, 1e-4);
    expectClose(atStart[1]?.pctSupply ?? 0, 9.666, 1e-4);
    expect(atStart[0]?.label).toBe("bonding_curve");
    expect(atStart[1]?.label).toBe("dev");

    sim.step(90);
    const all = sim.topHolders(1_000);
    expect(all.length).toBeGreaterThan(10);
    expect(Math.abs(all.reduce((sum, h) => sum + h.pctSupply, 0) - 100)).toBeLessThanOrEqual(1e-6);
    for (let i = 1; i < all.length; i += 1) {
      const previous = all[i - 1];
      const current = all[i];
      if (previous === undefined || current === undefined) continue;
      expect(previous.tokens).toBeGreaterThanOrEqual(current.tokens);
      if (previous.tokens === current.tokens) expect(previous.address < current.address).toBe(true);
    }
    expect(sim.topHolders(3)).toEqual(all.slice(0, 3));
    expect(all.filter((h) => h.label === undefined).every((h) => h.address.includes("…"))).toBe(
      true,
    );
    expect(all.find((h) => h.label === "dev")?.tokens).toBe(sim.position().tokens);
  });

  it("refuses bad arguments with a RangeError naming them", () => {
    const sim = createSimulation(config());
    expect(() => sim.step(-1)).toThrow(/dtSec/);
    expect(() => sim.step(NaN)).toThrow(RangeError);
    expect(() => sim.sellDev(0.3)).toThrow(/fraction/);
    expect(() => sim.topHolders(0)).toThrow(/limit/);
    expect(() => createSimulation(config({ seed: 2 ** 32 }))).toThrow(/seed/);
    expect(() => createSimulation(config({ durationSec: 0 }))).toThrow(/durationSec/);
    expect(() => createSimulation(config({ solUsdPrice: NaN }))).toThrow(/solUsdPrice/);
    expect(() => createSimulation({ ...config(), devBuySol: -1 })).toThrow(/devBuySol/);
    expect(() => createSimulation(config({ bundleSol: -1 }))).toThrow(/bundleSol/);
    expect(() => createSimulation(config({ bundleSol: NaN }))).toThrow(/bundleSol/);
    expect(() => createSimulation(config({ solUsdPrice: null }))).not.toThrow();
  });
});

describe("assertSimConfig", () => {
  it("accepts a valid config and names the field at fault otherwise", () => {
    expect(() => assertSimConfig(config())).not.toThrow();
    expect(() => assertSimConfig(null)).toThrow(RangeError);
    expect(() =>
      assertSimConfig({ ...config(), curve: { ...FALLBACK_CURVE_PARAMS, feeRate: 2 } }),
    ).toThrow(/feeRate/);
    expect(() =>
      assertSimConfig({ ...config(), preset: { ...presetForAmount(3), pBuy: -1 } }),
    ).toThrow(/pBuy/);
    expect(() => assertSimConfig({ ...config(), solUsdPrice: "150" })).toThrow(/solUsdPrice/);
  });
});

describe("acceptance (§15) through the public API", () => {
  it.each([3, 5, 10])(
    "ends above the price after a dev buy of %s SOL for seeds 1 to 1 000",
    (devBuySol) => {
      let above = 0;
      for (let seed = 1; seed <= 1_000; seed += 1) {
        const sim = createSimulation(config({ seed, devBuySol }));
        const reference = sim.openingBuys()[0].price;
        sim.step(180);
        expect(sim.endReason()).not.toBeNull();
        if (sim.state().price > reference) above += 1;
      }
      expect(above).toBe(1_000);
    },
  );
});
