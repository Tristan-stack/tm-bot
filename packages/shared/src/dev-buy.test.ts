import { describe, expect, it } from "vitest";
import { formatSolNumber } from "./format/sol.js";
import {
  curveParamsSchema,
  devBuyAmountSchema,
  parseDevBuyAmount,
  presetParamsSchema,
  simConfigSchema,
} from "./schemas.js";

describe("parseDevBuyAmount", () => {
  it.each([
    ["1", 1],
    ["20", 20],
    ["2.5", 2.5],
    ["2,5", 2.5],
    ["5 sol", 5],
    ["5SOL", 5],
    [" 1.125 ", 1.125],
    ["07", 7],
  ])("accepts %j as %s SOL", (text, sol) => {
    expect(parseDevBuyAmount(text)).toEqual({ ok: true, sol });
    expect(devBuyAmountSchema.parse(text)).toBe(sol);
  });

  it.each(["0.99", "20.001", "21", "-5", "1e1", "abc", "1.1234", "", "1.", ".5", "5 usd", "1 000"])(
    "refuses %j",
    (text) => {
      expect(parseDevBuyAmount(text)).toEqual({ ok: false });
      expect(devBuyAmountSchema.safeParse(text).success).toBe(false);
    },
  );
});

describe("formatSolNumber", () => {
  it("shows an integer bare, and the useful decimals otherwise", () => {
    expect(formatSolNumber(5)).toBe("5 SOL");
    expect(formatSolNumber(2.5)).toBe("2.5 SOL");
    expect(formatSolNumber(1.125)).toBe("1.125 SOL");
    expect(formatSolNumber(10)).toBe("10 SOL");
  });
});

const CURVE = {
  virtualSol: 30,
  virtualTokens: 1_073_000_000,
  realTokens: 793_100_000,
  totalSupply: 1_000_000_000,
  feeRate: 0.01,
};
const PRESET = {
  lambda0: 1.2,
  pBuy: 0.58,
  mu: Math.log(0.25),
  sigma: 1,
  minTrade: 0.01,
  maxTrade: 5,
};
const CONFIG = {
  seed: 42,
  devBuySol: 5,
  durationSec: 180,
  curve: CURVE,
  preset: PRESET,
  solUsdPrice: 150,
};

describe("simConfigSchema", () => {
  it("accepts a full SimConfig, with or without a SOL price", () => {
    expect(simConfigSchema.parse(CONFIG)).toEqual(CONFIG);
    expect(simConfigSchema.parse({ ...CONFIG, solUsdPrice: null }).solUsdPrice).toBeNull();
  });

  it.each([
    ["a seed above uint32", { seed: 2 ** 32 }],
    ["a fractional seed", { seed: 1.5 }],
    ["a dev buy of 0.5 SOL", { devBuySol: 0.5 }],
    ["a dev buy of 21 SOL", { devBuySol: 21 }],
    ["a zero duration", { durationSec: 0 }],
    ["a missing curve", { curve: undefined }],
    ["a SOL price of 0", { solUsdPrice: 0 }],
  ])("refuses %s", (_label, overrides) => {
    expect(simConfigSchema.safeParse({ ...CONFIG, ...overrides }).success).toBe(false);
  });

  it("applies the rules of the curve and of the preset", () => {
    expect(curveParamsSchema.safeParse({ ...CURVE, realTokens: CURVE.virtualTokens }).success).toBe(
      false,
    );
    expect(curveParamsSchema.safeParse({ ...CURVE, totalSupply: 1 }).success).toBe(false);
    expect(curveParamsSchema.safeParse({ ...CURVE, feeRate: 1 }).success).toBe(false);
    expect(presetParamsSchema.safeParse({ ...PRESET, pBuy: 1.1 }).success).toBe(false);
    expect(presetParamsSchema.safeParse({ ...PRESET, maxTrade: 0.001 }).success).toBe(false);
  });
});
