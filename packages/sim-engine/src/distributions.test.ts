import { describe, expect, it } from "vitest";
import {
  bernoulli,
  exponential,
  logNormal,
  logNormalBounded,
  normal,
  standardNormal,
} from "./distributions.js";
import { createRng } from "./rng.js";
import type { Rng } from "./rng.js";

const DRAWS = 100_000;

const sample = (draw: (rng: Rng) => number, count = DRAWS, seed = 1): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => draw(rng));
};
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
const stdDev = (values: number[]): number => {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) * (v - m))));
};
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? NaN;
};

/** An rng that counts its draws. */
function countingRng(seed: number): { rng: Rng; draws: () => number } {
  const inner = createRng(seed);
  let count = 0;
  const counted = <T>(fn: () => T) => {
    count += 1;
    return fn();
  };
  const rng: Rng = {
    nextUint32: () => counted(() => inner.nextUint32()),
    next: () => counted(() => inner.next()),
    nextOpenClosed: () => counted(() => inner.nextOpenClosed()),
    int: (n) => counted(() => inner.int(n)),
    pick: (items) => counted(() => inner.pick(items)),
  };
  return { rng, draws: () => count };
}

describe("exponential", () => {
  it("has a mean of 1/rate: 0.5 ± 0.01 for a rate of 2", () => {
    const values = sample((rng) => exponential(rng, 2));
    expect(mean(values)).toBeCloseTo(0.5, 2);
    for (const v of values.slice(0, 1_000)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("refuses a rate that is not a finite number > 0", () => {
    const rng = createRng(1);
    for (const rate of [0, -1, NaN, Infinity]) {
      expect(() => exponential(rng, rate)).toThrow(RangeError);
    }
  });
});

describe("bernoulli", () => {
  it("is true with the frequency 0.56 ± 0.01", () => {
    const values = sample((rng) => (bernoulli(rng, 0.56) ? 1 : 0));
    expect(mean(values)).toBeCloseTo(0.56, 2);
  });

  it("clamps p to [0, 1] and refuses NaN", () => {
    const rng = createRng(1);
    expect(sample((r) => (bernoulli(r, 1.5) ? 1 : 0), 100).every((v) => v === 1)).toBe(true);
    expect(sample((r) => (bernoulli(r, -1) ? 1 : 0), 100).every((v) => v === 0)).toBe(true);
    expect(() => bernoulli(rng, NaN)).toThrow(RangeError);
  });
});

describe("standardNormal and normal", () => {
  it("has a mean of 0 ± 0.02 and a standard deviation of 1 ± 0.02", () => {
    const values = sample(standardNormal);
    expect(Math.abs(mean(values))).toBeLessThanOrEqual(0.02);
    expect(Math.abs(stdDev(values) - 1)).toBeLessThanOrEqual(0.02);
  });

  it("consumes exactly two uniforms per call", () => {
    const { rng, draws } = countingRng(3);
    standardNormal(rng);
    expect(draws()).toBe(2);
    normal(rng, 10, 2);
    expect(draws()).toBe(4);
  });

  it("normal shifts and scales the standard draw", () => {
    const values = sample((rng) => normal(rng, 10, 2));
    expect(mean(values)).toBeCloseTo(10, 1);
    expect(stdDev(values)).toBeCloseTo(2, 1);
  });
});

describe("logNormal and logNormalBounded", () => {
  it("has a median close to exp(mu)", () => {
    const values = sample((rng) => logNormal(rng, Math.log(0.2), 1));
    expect(median(values)).toBeCloseTo(0.2, 2);
  });

  it("stays within [min, max] with a median still close to exp(mu)", () => {
    const values = sample((rng) => logNormalBounded(rng, Math.log(0.25), 1, 0.01, 5));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.01);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(median(values)).toBeCloseTo(0.25, 2);
    expect(values.some((v) => v === 5)).toBe(true);
    expect(values.some((v) => v === 0.01)).toBe(true);
  });

  it("consumes the same two uniforms whether clipped or not", () => {
    const { rng, draws } = countingRng(5);
    logNormalBounded(rng, 0, 1, 0.5, 2);
    expect(draws()).toBe(2);
  });

  it("refuses min ≤ 0 or min > max", () => {
    const rng = createRng(1);
    expect(() => logNormalBounded(rng, 0, 1, 0, 1)).toThrow(RangeError);
    expect(() => logNormalBounded(rng, 0, 1, 2, 1)).toThrow(RangeError);
    expect(() => logNormalBounded(rng, 0, 1, 1, NaN)).toThrow(RangeError);
  });
});
