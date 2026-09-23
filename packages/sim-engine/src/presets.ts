import { clamp, dmath } from "./dmath.js";
import { checkNumber, checkPositive, isRecord, rangeError } from "./errors.js";
import type { PresetParams } from "./types.js";

type PresetRow = { devBuySol: 3 | 5 | 10; lambda0: number; pBuy: number; medianSol: number };

/**
 * Presets tied to the dev buy (§7.3): a demo hypothesis, not a relation observed on
 * pump.fun. Starting values, "to adjust by eye".
 */
export const PRESET_TABLE: readonly [PresetRow, PresetRow, PresetRow] = Object.freeze([
  { devBuySol: 3, lambda0: 0.8, pBuy: 0.56, medianSol: 0.2 },
  { devBuySol: 5, lambda0: 1.2, pBuy: 0.58, medianSol: 0.25 },
  { devBuySol: 10, lambda0: 2.0, pBuy: 0.6, medianSol: 0.3 },
] as const);

/** "σ is about 1.0 for every preset" (§7.3). */
export const PRESET_SIGMA = 1;
/** Bounds of a trade size in SOL, absent from the context (proposal, V1-19). */
export const MIN_TRADE_SOL = 0.01;
export const MAX_TRADE_SOL = 5;

const lerp = (a: number, b: number, w: number): number => a + (b - a) * w;

/**
 * The preset of a dev buy: the table for 3, 5 and 10 SOL, an interpolation on log(dev buy)
 * between them for Custom, and the nearest preset outside [3, 10]. The 1–20 SOL check of
 * the input stays upstream (V1-22).
 */
export function presetForDevBuy(devBuySol: number): PresetParams {
  checkPositive(devBuySol, "devBuySol");
  const [low, mid, high] = PRESET_TABLE;
  const d = clamp(devBuySol, low.devBuySol, high.devBuySol);
  const [a, b] = d <= mid.devBuySol ? [low, mid] : [mid, high];
  const w = dmath.ln(d / a.devBuySol) / dmath.ln(b.devBuySol / a.devBuySol);
  return {
    lambda0: lerp(a.lambda0, b.lambda0, w),
    pBuy: lerp(a.pBuy, b.pBuy, w),
    mu: dmath.ln(lerp(a.medianSol, b.medianSol, w)),
    sigma: PRESET_SIGMA,
    minTrade: MIN_TRADE_SOL,
    maxTrade: MAX_TRADE_SOL,
  };
}

/** The six fields of §7.4, each within its domain; a RangeError names the field at fault. */
export function assertPresetParams(preset: unknown): asserts preset is PresetParams {
  if (!isRecord(preset)) throw rangeError("preset", "an object");
  checkPositive(preset.lambda0, "lambda0");
  checkNumber(preset.pBuy, "pBuy", "a number in [0, 1]", (n) => n >= 0 && n <= 1);
  checkNumber(preset.mu, "mu", "a finite number", Number.isFinite);
  checkNumber(preset.sigma, "sigma", "a finite number ≥ 0", (n) => Number.isFinite(n) && n >= 0);
  const minTrade = checkPositive(preset.minTrade, "minTrade");
  checkNumber(
    preset.maxTrade,
    "maxTrade",
    "a finite number ≥ minTrade",
    (n) => Number.isFinite(n) && n >= minTrade,
  );
}
