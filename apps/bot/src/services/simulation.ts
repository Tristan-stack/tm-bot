import type { SimulationStore } from "@launchbot/db";
import { SIM_DURATION_SEC, SIMULATION_REUSE_MS, simConfigSchema } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import { assertSimConfig, presetForDevBuy } from "@launchbot/sim-engine";
import type { CurveParams, SimConfig } from "@launchbot/sim-engine";
import { randomInt } from "node:crypto";
import type { DataServices } from "./data.js";

/**
 * The `SimConfig` of a Simulation (§7.4): the preset follows the dev buy (3, 5 and 10 SOL
 * exact, a Custom amount interpolated, V1-19), the duration is the 3 min of §6, the curve and
 * the SOL price are those of the moment. Checked by the engine and by the schema the API and
 * the Mini App apply to the stored JSON, so what is written is what they will accept.
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

/** Seeds fit the uint32 of the engine and the signed Int of Prisma (proposal): 0 to 2^31 − 1. */
export const MAX_SEED = 2 ** 31 - 1;
export const drawSeed = (): number => randomInt(0, MAX_SEED + 1);

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

  return {
    async prepare({ userId, telegramId, draft, devBuySol }) {
      const key = { userId, tokenDraftId: draft.id, devBuySol };
      const existing = await store.findLatest(key, new Date(now() - SIMULATION_REUSE_MS));
      if (existing !== null) {
        // Stored by this service: the JSON is the config it validated.
        return { kind: "ok", simId: existing.id, config: simConfigSchema.parse(existing.params) };
      }

      if (!consumeRateLimit(telegramId, "simulation", now()).ok) return { kind: "rate_limited" };

      // Neither read blocks the recap: the curve falls back to §7.1, the price to null.
      const [{ curve }, solUsdPrice] = await Promise.all([
        data.getCurveParams(),
        data.getSolUsdPrice(),
      ]);
      const config = buildSimConfig({ seed: seed(), devBuySol, curve, solUsdPrice });
      const row = await store.create({ ...key, seed: config.seed, params: config });
      return { kind: "ok", simId: row.id, config };
    },
  };
}
