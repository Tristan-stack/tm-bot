import type { Simulation, SimulationStore } from "@launchbot/db";
import {
  DEV_BUY_SOL,
  SIM_DURATION_SEC,
  SIM_SEED_MAX,
  SIMULATION_REUSE_MS,
  simConfigSchema,
} from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import { assertSimConfig, presetForAmount } from "@launchbot/sim-engine";
import type { CurveParams, SimConfig } from "@launchbot/sim-engine";
import { randomInt } from "node:crypto";
import type { DataServices } from "./data.js";

/**
 * The `SimConfig` of a Simulation (§7.4): the dev buy, then the bundle (decision of
 * 25/09/2026), whose amount picks the preset (3, 5 and 10 SOL exact, a Custom amount
 * interpolated, V1-19); the duration is the 3 min of §6, the curve and the SOL price are those
 * of the moment. Checked by the engine and by the schema the bot applies when it reads the
 * stored JSON back, so what is written is what it will accept.
 */
export function buildSimConfig(params: {
  seed: number;
  devBuySol: number;
  bundleSol: number;
  curve: CurveParams;
  solUsdPrice: number | null;
}): SimConfig {
  const config: SimConfig = {
    seed: params.seed,
    devBuySol: params.devBuySol,
    bundleSol: params.bundleSol,
    durationSec: SIM_DURATION_SEC,
    curve: params.curve,
    preset: presetForAmount(params.bundleSol),
    solUsdPrice: params.solUsdPrice,
  };
  assertSimConfig(config);
  simConfigSchema.parse(config);
  return config;
}

/** Within `SIM_SEED_MAX`: the seed of a new Simulation, and of a Run again (V1-26). */
export const drawSeed = (): number => randomInt(0, SIM_SEED_MAX + 1);

export type PrepareSimulationResult =
  { kind: "ok"; simId: string; config: SimConfig } | { kind: "rate_limited" };

export type SimulationService = {
  /**
   * The Simulation a recap shows (D14): the one of this user, draft and bundle created in the
   * last hour, else a new row, drawn from a fresh seed, under the limit of creations (D17). A
   * reuse costs nothing of the limit. The draft was accepted by the Token step (name and
   * ticker there, owned by the user): the service reads nothing of it but its id.
   */
  prepare: (params: {
    userId: string;
    telegramId: number;
    draft: { id: string };
    bundleSol: number;
  }) => Promise<PrepareSimulationResult>;
  /**
   * Run again (§6.3, D21): a new row for the same user, draft, dev buy and bundle, with the same
   * config but a fresh seed (never the same), under the limit of creations like a first one.
   */
  restart: (params: {
    sim: Pick<Simulation, "userId" | "tokenDraftId" | "params">;
    telegramId: number;
  }) => Promise<PrepareSimulationResult>;
  /**
   * The chart of a launch (decision of 26/09/2026): a new row every time, from a fresh seed —
   * each launch has its own chart — outside the limit of creations: a funded launch is its own
   * limit.
   */
  prepareLaunch: (params: {
    userId: string;
    draft: { id: string };
    bundleSol: number;
  }) => Promise<{ simId: string; config: SimConfig }>;
};

export type SimulationServiceDeps = {
  store: Pick<SimulationStore, "findLatest" | "create">;
  data: Pick<DataServices, "getCurveParams" | "getSolUsdPrice">;
  now?: () => number;
  /** Test seam: the seed of the next Simulation. */
  seed?: () => number;
};

export function createSimulationService(deps: SimulationServiceDeps): SimulationService {
  const { store, data, now = Date.now, seed = drawSeed } = deps;

  type Owner = { userId: string; tokenDraftId: string };

  /** A new row: its columns come from the config, as its seed does, so they cannot disagree. */
  async function insert(owner: Owner, params: SimConfig) {
    const { seed, devBuySol, bundleSol } = params;
    const row = await store.create({ ...owner, devBuySol, bundleSol, seed, params });
    return { simId: row.id, config: params };
  }

  /** A new row under the limit of creations, or `rate_limited`. */
  async function create(
    owner: Owner,
    telegramId: number,
    config: () => Promise<SimConfig>,
  ): Promise<PrepareSimulationResult> {
    if (!consumeRateLimit(telegramId, "simulation", now()).ok) return { kind: "rate_limited" };
    return { kind: "ok", ...(await insert(owner, await config())) };
  }

  /** The dev buy fixed (decision of 25/09/2026), the curve and the price of the moment. */
  async function freshConfig(bundleSol: number): Promise<SimConfig> {
    // Neither read blocks: the curve falls back to §7.1, the price to null.
    const [{ curve }, solUsdPrice] = await Promise.all([
      data.getCurveParams(),
      data.getSolUsdPrice(),
    ]);
    return buildSimConfig({ seed: seed(), devBuySol: DEV_BUY_SOL, bundleSol, curve, solUsdPrice });
  }

  return {
    async prepare({ userId, telegramId, draft, bundleSol }) {
      const owner = { userId, tokenDraftId: draft.id };
      const since = new Date(now() - SIMULATION_REUSE_MS);
      const existing = await store.findLatest(
        { ...owner, devBuySol: DEV_BUY_SOL, bundleSol },
        since,
      );
      if (existing !== null) {
        // Stored by this service: the JSON is the config it validated.
        return { kind: "ok", simId: existing.id, config: simConfigSchema.parse(existing.params) };
      }

      return create(owner, telegramId, () => freshConfig(bundleSol));
    },

    prepareLaunch: async ({ userId, draft, bundleSol }) =>
      insert({ userId, tokenDraftId: draft.id }, await freshConfig(bundleSol)),

    restart({ sim, telegramId }) {
      return create({ userId: sim.userId, tokenDraftId: sim.tokenDraftId }, telegramId, () => {
        const previous = simConfigSchema.parse(sim.params);
        let next = seed();
        if (next === previous.seed) next = (next + 1) % (SIM_SEED_MAX + 1);
        return Promise.resolve({ ...previous, seed: next });
      });
    },
  };
}
