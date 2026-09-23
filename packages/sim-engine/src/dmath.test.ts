import { describe, expect, it } from "vitest";
import { dmath } from "./dmath.js";

/** Relative gap, with an absolute floor of 1e-3 on the reference for the zeros of sin/cos. */
const relativeGap = (actual: number, reference: number): number =>
  Math.abs(actual - reference) / Math.max(Math.abs(reference), 1e-3);

const grid = (from: number, to: number, steps: number): number[] =>
  Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);

const float64Hex = (value: number): string => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return Array.from({ length: 8 }, (_, i) => view.getUint8(i).toString(16).padStart(2, "0")).join(
    "",
  );
};

describe("dmath", () => {
  it("ln is within 1e-12 of Math.log on [1e-12, 1e6]", () => {
    for (let i = 0; i <= 2_000; i += 1) {
      const x = 1e-12 * Math.pow(1e18, i / 2_000);
      expect(relativeGap(dmath.ln(x), Math.log(x))).toBeLessThanOrEqual(1e-12);
    }
    expect(dmath.ln(1)).toBe(0);
    expect(dmath.ln(Number.MAX_VALUE)).toBeCloseTo(Math.log(Number.MAX_VALUE), 12);
    expect(dmath.ln(Infinity)).toBe(Infinity);
  });

  it("exp is within 1e-12 of Math.exp on [−50, 50]", () => {
    for (const x of grid(-50, 50, 2_000)) {
      expect(relativeGap(dmath.exp(x), Math.exp(x))).toBeLessThanOrEqual(1e-12);
    }
    expect(dmath.exp(0)).toBe(1);
    expect(relativeGap(dmath.exp(709.7), Math.exp(709.7))).toBeLessThanOrEqual(1e-12);
    expect(dmath.exp(710)).toBe(Infinity);
    expect(dmath.exp(-800)).toBe(0);
    expect(dmath.exp(-Infinity)).toBe(0);
    expect(dmath.exp(NaN)).toBeNaN();
  });

  it("sin and cos are within 1e-12 of Math.sin and Math.cos on [−100, 100]", () => {
    for (const x of grid(-100, 100, 4_000)) {
      expect(relativeGap(dmath.sin(x), Math.sin(x))).toBeLessThanOrEqual(1e-12);
      expect(relativeGap(dmath.cos(x), Math.cos(x))).toBeLessThanOrEqual(1e-12);
    }
    expect(dmath.sin(0)).toBe(0);
    expect(dmath.cos(0)).toBe(1);
    expect(dmath.sin(Infinity)).toBeNaN();
    expect(dmath.cos(NaN)).toBeNaN();
  });

  it("refuses a logarithm of zero, a negative number or NaN", () => {
    for (const x of [0, -1, NaN]) expect(() => dmath.ln(x)).toThrow(RangeError);
  });

  it("returns the same Float64 bits as when these fixtures were recorded", () => {
    // A different result on another engine would mean a divergent simulation.
    expect(float64Hex(dmath.ln(2))).toBe("3fe62e42fefa39ef");
    expect(float64Hex(dmath.ln(1e-9))).toBe("c034b927f32bffb8");
    expect(float64Hex(dmath.ln(123456.789))).toBe("40277281cad8a844");
    expect(float64Hex(dmath.exp(1))).toBe("4005bf0a8b145768");
    expect(float64Hex(dmath.exp(-7.25))).toBe("3f47455fe323fafd");
    expect(float64Hex(dmath.exp(12.5))).toBe("411060c52565ba66");
    expect(float64Hex(dmath.sin(1))).toBe("3feaed548f090cee");
    expect(float64Hex(dmath.sin(-77.7))).toBe("bfe7d31cb31f6497");
    expect(float64Hex(dmath.cos(1))).toBe("3fe14a280fb5068b");
    expect(float64Hex(dmath.cos(31.4))).toBe("3feffef60790cc74");
  });
});
