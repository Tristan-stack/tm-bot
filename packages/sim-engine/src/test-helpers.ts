import { expect } from "vitest";
import { FALLBACK_CURVE_PARAMS } from "./curve.js";
import { presetForAmount } from "./presets.js";
import type { SimConfig } from "./types.js";

/** Relative tolerance of the reference vectors of the cards: 1e-9 by default. */
export const expectClose = (actual: number, expected: number, relative = 1e-9): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * relative);
};

/** A 3 SOL run of 180 s on the fallback curve, without a bundle: the preset follows the dev buy. */
export const simConfig = (overrides: Partial<SimConfig> = {}): SimConfig => ({
  seed: 42,
  devBuySol: 3,
  bundleSol: 0,
  durationSec: 180,
  curve: FALLBACK_CURVE_PARAMS,
  preset: presetForAmount(overrides.devBuySol ?? 3),
  solUsdPrice: 150,
  ...overrides,
});
