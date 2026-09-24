import type { Simulation, SimulationKey, SimulationStore } from "@launchbot/db";
import {
  SIM_DURATION_SEC,
  SIM_SEED_MAX,
  SIMULATION_REUSE_MS,
  simConfigSchema,
} from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import { assertSimConfig, presetForDevBuy } from "@launchbot/sim-engine";
import type { CurveParams, SimConfig } from "@launchbot/sim-engine";
import { randomInt } from "node:crypto";
import type { DataServices } from "./data.js";

/**
 * The `SimConfig` of a Simulation (§7.4): the preset follows the dev buy (3, 5 and 10 SOL
 * exact, a Custom amount interpolated, V1-19), the duration is the 3 min of §6, the curve and
 * the SOL price are those of the moment. Checked by the engine and by the schema the bot
 * applies when it reads the stored JSON back, so what is written is what it will accept.
 */
export function buildSimConfig(params: {
  seed: number;
  devBuySol: number;
  curve: CurveParams;
  solUsdPrice: number | null;
}): SimConfig {
  const config: SimConfig = {
    seed: params.seed,
    devBuySol: params.devBuySol,
    durationSec: SIM_DURATION_SEC,
    curve: params.curve,
    preset: presetForDevBuy(params.devBuySol),
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
   * The Simulation a recap shows (D14): the one of this user, draft and dev buy created in the
   * last hour, else a new row, drawn from a fresh seed, under the limit of creations (D17). A
   * reuse costs nothing of the limit. The draft was accepted by the Token step (name and
   * ticker there, owned by the user): the service reads nothing of it but its id.
   */
  prepare: (params: {
    userId: string;
    telegramId: number;
    draft: { id: string };
    devBuySol: number;
  }) => Promise<PrepareSimulationResult>;
  /**
   * Run again (§6.3, D21): a new row for the same user, draft and dev buy, with the same
   * config but a fresh seed (never the same), under the limit of creations like a first one.
   */
  restart: (params: {
    sim: Pick<Simulation, "userId" | "tokenDraftId" | "devBuySol" | "params">;
    telegramId: number;
  }) => Promise<PrepareSimulationResult>;
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

  /** A new row under the limit of creations, or `rate_limited`. */
  async function create(
    key: SimulationKey,
    telegramId: number,
    config: () => Promise<SimConfig>,
  ): Promise<PrepareSimulationResult> {
    if (!consumeRateLimit(telegramId, "simulation", now()).ok) return { kind: "rate_limited" };
    const params = await config();
    const row = await store.create({ ...key, seed: params.seed, params });
    return { kind: "ok", simId: row.id, config: params };
  }

  return {
    async prepare({ userId, telegramId, draft, devBuySol }) {
      const key = { userId, tokenDraftId: draft.id, devBuySol };
      const existing = await store.findLatest(key, new Date(now() - SIMULATION_REUSE_MS));
      if (existing !== null) {
        // Stored by this service: the JSON is the config it validated.
        return { kind: "ok", simId: existing.id, config: simConfigSchema.parse(existing.params) };
      }

      return create(key, telegramId, async () => {
        // Neither read blocks the recap: the curve falls back to §7.1, the price to null.
        const [{ curve }, solUsdPrice] = await Promise.all([
          data.getCurveParams(),
          data.getSolUsdPrice(),
        ]);
        return buildSimConfig({ seed: seed(), devBuySol, curve, solUsdPrice });
      });
    },

    restart({ sim, telegramId }) {
      const key = {
        userId: sim.userId,
        tokenDraftId: sim.tokenDraftId,
        devBuySol: Number(sim.devBuySol),
      };
      return create(key, telegramId, () => {
        const previous = simConfigSchema.parse(sim.params);
        let next = seed();
        if (next === previous.seed) next = (next + 1) % (SIM_SEED_MAX + 1);
        return Promise.resolve({ ...previous, seed: next });
      });
    },
  };
}
