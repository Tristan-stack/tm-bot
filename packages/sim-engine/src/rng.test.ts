import { describe, expect, it } from "vitest";
import { createRng, deriveSeed, isValidSeed } from "./rng.js";

const take = (seed: number, count: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.nextUint32());
};

describe("createRng", () => {
  it("matches the control vectors of sfc32 seeded by SplitMix32", () => {
    expect(take(42, 3)).toEqual([853279530, 1920286840, 3588795744]);
    expect(take(0, 3)).toEqual([3047368389, 387095348, 2506032770]);
  });

  it("replays the same 10 000 outputs from the same seed", () => {
    expect(take(2026, 10_000)).toEqual(take(2026, 10_000));
  });

  it("gives different sequences to different seeds", () => {
    expect(take(1, 100)).not.toEqual(take(2, 100));
    expect(take(0, 100)).not.toEqual(take(0xffffffff, 100));
  });

  it("refuses everything but a uint32", () => {
    for (const seed of [-1, 1.5, 2 ** 32, NaN, Infinity]) {
      expect(() => createRng(seed)).toThrow(RangeError);
    }
    expect(() => createRng(0)).not.toThrow();
    expect(() => createRng(0xffffffff)).not.toThrow();
  });

  it("draws floats in [0, 1) with a mean of 0.5 ± 0.01 over 100 000 draws", () => {
    const rng = createRng(7);
    let sum = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const u = rng.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      sum += u;
    }
    expect(sum / 100_000).toBeCloseTo(0.5, 2);
  });

  it("draws nextOpenClosed in (0, 1], integers below a bound and picks from a list", () => {
    const rng = createRng(9);
    for (let i = 0; i < 1_000; i += 1) {
      const u = rng.nextOpenClosed();
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThanOrEqual(1);
      const n = rng.int(58);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(58);
      expect(["a", "b", "c"]).toContain(rng.pick(["a", "b", "c"]));
    }
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});

describe("deriveSeed", () => {
  it("is stable, distinct per stream and always a valid seed", () => {
    expect(deriveSeed(42, 1)).toBe(deriveSeed(42, 1));
    const streams = Array.from({ length: 6 }, (_, id) => deriveSeed(42, id + 1));
    expect(new Set(streams).size).toBe(6);
    for (const seed of streams) expect(isValidSeed(seed)).toBe(true);
    expect(deriveSeed(42, 1)).not.toBe(deriveSeed(43, 1));
  });

  it("refuses an invalid seed or stream id", () => {
    expect(() => deriveSeed(-1, 1)).toThrow(RangeError);
    expect(() => deriveSeed(1, -1)).toThrow(RangeError);
    expect(() => deriveSeed(1, 1.5)).toThrow(RangeError);
  });
});

describe("isValidSeed", () => {
  it("accepts a uint32 only", () => {
    expect(isValidSeed(0)).toBe(true);
    expect(isValidSeed(4294967295)).toBe(true);
    expect(isValidSeed(4294967296)).toBe(false);
    expect(isValidSeed(-1)).toBe(false);
    expect(isValidSeed(1.5)).toBe(false);
    expect(isValidSeed("1")).toBe(false);
    expect(isValidSeed(null)).toBe(false);
  });
});
