import { describe, expect, it } from "vitest";
import {
  assertPresetParams,
  MAX_TRADE_SOL,
  MIN_TRADE_SOL,
  PRESET_TABLE,
  presetForDevBuy,
} from "./presets.js";

describe("presetForDevBuy", () => {
  it("returns the exact table for 3, 5 and 10 SOL", () => {
    expect(PRESET_TABLE).toEqual([
      { devBuySol: 3, lambda0: 0.8, pBuy: 0.56, medianSol: 0.2 },
      { devBuySol: 5, lambda0: 1.2, pBuy: 0.58, medianSol: 0.25 },
      { devBuySol: 10, lambda0: 2.0, pBuy: 0.6, medianSol: 0.3 },
    ]);
    expect(presetForDevBuy(3)).toEqual({
      lambda0: 0.8,
      pBuy: 0.56,
      mu: expect.closeTo(-1.60944, 5) as number,
      sigma: 1,
      minTrade: MIN_TRADE_SOL,
      maxTrade: MAX_TRADE_SOL,
    });
    expect(presetForDevBuy(5)).toMatchObject({ lambda0: 1.2, pBuy: 0.58 });
    expect(presetForDevBuy(5).mu).toBeCloseTo(-1.38629, 5);
    expect(presetForDevBuy(10)).toMatchObject({ lambda0: 2.0, pBuy: 0.6 });
    expect(presetForDevBuy(10).mu).toBeCloseTo(-1.20397, 5);
  });

  it("interpolates a Custom dev buy on log(dev buy): the vectors d = 4 and d = 7", () => {
    const four = presetForDevBuy(4);
    expect(four.lambda0).toBeCloseTo(1.02527, 5);
    expect(four.pBuy).toBeCloseTo(0.57126, 5);
    expect(four.mu).toBeCloseTo(-1.47771, 5);
    const seven = presetForDevBuy(7);
    expect(seven.lambda0).toBeCloseTo(1.58834, 5);
    expect(seven.pBuy).toBeCloseTo(0.58971, 5);
    expect(seven.mu).toBeCloseTo(-1.29364, 5);
  });

  it("clamps to the 3 SOL preset below 3 SOL and to the 10 SOL preset above 10 SOL", () => {
    expect(presetForDevBuy(1)).toEqual(presetForDevBuy(3));
    expect(presetForDevBuy(2)).toEqual(presetForDevBuy(3));
    expect(presetForDevBuy(20)).toEqual(presetForDevBuy(10));
  });

  it("is monotonic in λ0, pBuy and median on [1, 20]", () => {
    let previous = presetForDevBuy(1);
    for (let d = 1.25; d <= 20; d += 0.25) {
      const current = presetForDevBuy(d);
      expect(current.lambda0).toBeGreaterThanOrEqual(previous.lambda0);
      expect(current.pBuy).toBeGreaterThanOrEqual(previous.pBuy);
      expect(current.mu).toBeGreaterThanOrEqual(previous.mu);
      previous = current;
    }
  });

  it("refuses 0, a negative number or NaN", () => {
    for (const d of [0, -1, NaN, Infinity]) expect(() => presetForDevBuy(d)).toThrow(RangeError);
  });
});

describe("assertPresetParams", () => {
  const preset = presetForDevBuy(5);

  it("accepts a preset and names the field at fault otherwise", () => {
    expect(() => assertPresetParams(preset)).not.toThrow();
    expect(() => assertPresetParams(null)).toThrow(RangeError);
    expect(() => assertPresetParams({ ...preset, lambda0: 0 })).toThrow(/lambda0/);
    expect(() => assertPresetParams({ ...preset, pBuy: 1.1 })).toThrow(/pBuy/);
    expect(() => assertPresetParams({ ...preset, mu: NaN })).toThrow(/mu/);
    expect(() => assertPresetParams({ ...preset, sigma: -1 })).toThrow(/sigma/);
    expect(() => assertPresetParams({ ...preset, minTrade: 0 })).toThrow(/minTrade/);
    expect(() => assertPresetParams({ ...preset, maxTrade: 0.001 })).toThrow(/maxTrade/);
    expect(() => assertPresetParams({ ...preset, sigma: 0 })).not.toThrow();
  });
});
