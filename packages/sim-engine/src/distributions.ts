import { clamp, dmath, TWO_PI } from "./dmath.js";
import { checkPositive, rangeError } from "./errors.js";
import type { Rng } from "./rng.js";

/** Delay between two trades (§7.2): −ln(u) / rate with u in (0, 1]. One uniform. */
export function exponential(rng: Rng, rate: number): number {
  checkPositive(rate, "rate");
  return -dmath.ln(rng.nextOpenClosed()) / rate;
}

/** Buy or sell (§7.2): true with probability p, clamped to [0, 1]. One uniform. */
export function bernoulli(rng: Rng, p: number): boolean {
  if (Number.isNaN(p)) throw rangeError("p", "a number");
  return rng.next() < clamp(p, 0, 1);
}

/** A float in [min, max). One uniform. */
export const uniform = (rng: Rng, min: number, max: number): number =>
  min + rng.next() * (max - min);

/**
 * Box-Muller: √(−2·ln u1)·cos(2π·u2). Exactly two uniforms per call; the sine twin is
 * not cached, so the consumption stays predictable (V1-19 aligns its streams on it).
 */
export function standardNormal(rng: Rng): number {
  const u1 = rng.nextOpenClosed();
  const u2 = rng.next();
  return Math.sqrt(-2 * dmath.ln(u1)) * dmath.cos(TWO_PI * u2);
}

export function normal(rng: Rng, mean: number, sd: number): number {
  return mean + sd * standardNormal(rng);
}

/** Trade size (§7.2): exp(μ + σ·Z). */
export function logNormal(rng: Rng, mu: number, sigma: number): number {
  return dmath.exp(mu + sigma * standardNormal(rng));
}

/** The log-normal clipped to [min, max]: a fixed number of draws (proposal, V1-18). */
export function logNormalBounded(
  rng: Rng,
  mu: number,
  sigma: number,
  min: number,
  max: number,
): number {
  checkPositive(min, "min");
  if (!(max >= min)) throw rangeError("max", "a number ≥ min");
  return clamp(logNormal(rng, mu, sigma), min, max);
}

/**
 * The item whose cumulative weight, summed in list order, first exceeds u × total. A
 * zero-weight item is never picked; the last positive one catches a rounding of u × total.
 * `undefined` when no item weighs anything.
 */
export function pickWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  u: number,
): T | undefined {
  let total = 0;
  let last: T | undefined;
  for (const item of items) {
    const weight = weightOf(item);
    total += weight;
    if (weight > 0) last = item;
  }
  if (last === undefined) return undefined;
  const target = u * total;
  let cumulative = 0;
  for (const item of items) {
    cumulative += weightOf(item);
    if (target < cumulative) return item;
  }
  return last;
}
