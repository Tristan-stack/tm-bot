import type { SimulationStore, TokenDraftService } from "@launchbot/db";
import {
  missingRequiredFields,
  SIM_DURATION_SEC,
  SIMULATION_REUSE_MS,
  simConfigSchema,
} from "@launchbot/shared";
import type { RequiredTokenField } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import { assertSimConfig, presetForDevBuy } from "@launchbot/sim-engine";
import type { CurveParams, SimConfig } from "@launchbot/sim-engine";
import { randomInt } from "node:crypto";
import type { DataServices } from "./data.js";

/**
 * The `SimConfig` of a Simulation (§7.4): the preset follows the dev buy (3, 5 and 10 SOL
 * exact, a Custom amount interpolated, V1-19), the duration is the 3 min of §6, the curve and
 * the SOL price are those of the moment. Checked by the engine and by the schema the API and
 * the Mini App will apply to the stored JSON.
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
  | { kind: "ok"; simId: string; config: SimConfig; reused: boolean }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "missing_fields"; missing: RequiredTokenField[] };

export type SimulationService = {
  /**
   * The Simulation a recap shows (D14): the one of this user, draft and dev buy created in the
   * last hour, else a new row, drawn from a fresh seed, under the limit of creations (D17). A
   * reuse costs nothing of the limit. `missing_fields`: the draft is gone or has no name or
   * ticker (a stale button, a purge).
   */
  prepare: (params: {
    userId: string;
    telegramId: number;
    draftId: string;
    devBuySol: number;
  }) => Promise<PrepareSimulationResult>;
};

export type SimulationServiceDeps = {
  store: SimulationStore;
  drafts: Pick<TokenDraftService, "getOwnedDraft">;
  data: Pick<DataServices, "getCurveParams" | "getSolUsdPrice">;
  now?: () => number;
  /** Test seam: the seed of the next Simulation. */
  seed?: () => number;
};

export function createSimulationService(deps: SimulationServiceDeps): SimulationService {
  const { store, drafts, data, now = Date.now, seed = drawSeed } = deps;

  return {
    async prepare({ userId, telegramId, draftId, devBuySol }) {
      const draft = await drafts.getOwnedDraft(userId, draftId);
      const missing = draft === null ? (["name", "ticker"] as const) : missingRequiredFields(draft);
      if (missing.length > 0) return { kind: "missing_fields", missing: [...missing] };

      const key = { userId, tokenDraftId: draftId, devBuySol };
      const existing = await store.findLatest(key, new Date(now() - SIMULATION_REUSE_MS));
      if (existing !== null) {
        // Stored by this service: the JSON is the config it validated.
        const config = simConfigSchema.parse(existing.params);
        return { kind: "ok", simId: existing.id, config, reused: true };
      }

      const verdict = consumeRateLimit(telegramId, "simulation", now());
      if (!verdict.ok) return { kind: "rate_limited", retryAfterMs: verdict.retryAfterMs };

      // Neither read blocks the recap: the curve falls back to §7.1, the price to null.
      const [{ curve }, solUsdPrice] = await Promise.all([
        data.getCurveParams(),
        data.getSolUsdPrice(),
      ]);
      const config = buildSimConfig({ seed: seed(), devBuySol, curve, solUsdPrice });
      const row = await store.create({ ...key, seed: config.seed, params: config });
      return { kind: "ok", simId: row.id, config, reused: false };
    },
  };
}
