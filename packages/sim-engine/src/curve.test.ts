import { describe, expect, it } from "vitest";
import {
  assertCurveParams,
  BondingCurve,
  curveProgress,
  devBuySupplyShare,
  DUST_TOKENS,
  FALLBACK_CURVE_PARAMS,
  marketCapSol,
} from "./curve.js";
import { CurveCompleteError } from "./errors.js";
import { createRng } from "./rng.js";
import { expectClose } from "./test-helpers.js";

const P = FALLBACK_CURVE_PARAMS;

describe("BondingCurve on the fallback params", () => {
  it("starts at the price, market cap and k of §7.1", () => {
    const curve = new BondingCurve(P);
    const state = curve.state();
    expectClose(state.price, 2.7959e-8, 1e-4);
    expectClose(marketCapSol(state, P), 27.959, 1e-4);
    expect(state.x * state.y).toBe(32_190_000_000);
    expect(curveProgress(state, P)).toBe(0);
    expect(Math.abs(curve.circulatingTokens())).toBeLessThanOrEqual(DUST_TOKENS);
    expect(curve.isComplete()).toBe(false);
  });

  it.each([
    [1, 34_277_831.56, 0.03428],
    [3, 96_657_870.79, 0.09666],
    [5, 151_969_957.08, 0.15197],
    [10, 266_233_082.71, 0.2662],
    [20, 426_614_457.83, 0.4266],
  ])(
    "dev buy of %s SOL gives the tokens and the supply share of the card",
    (sol, tokens, share) => {
      const quote = new BondingCurve(P).quoteBuy(sol);
      expectClose(quote.tokensOut, tokens);
      expect(quote.capped).toBe(false);
      expect(quote.solUsed).toBe(sol);
      expect(quote.fee).toBeCloseTo(sol * 0.01, 12);
      const supply = devBuySupplyShare(P, sol);
      expectClose(supply.tokens, tokens);
      expectClose(supply.share, share, 1e-3);
      expect(supply.capped).toBe(false);
    },
  );

  it("after 3 SOL: x = 32.97, the price, the market cap and the progress of the card", () => {
    const curve = new BondingCurve(P);
    const quote = curve.buy(3);
    const state = curve.state();
    expectClose(state.x, 32.97);
    expectClose(state.price, 3.37689e-8, 1e-5);
    expectClose(quote.priceAfter, state.price);
    expectClose(marketCapSol(state, P), 33.769, 1e-4);
    expectClose(curveProgress(state, P), 0.1219, 1e-3);
    expectClose(curve.circulatingTokens(), 96_657_870.79);
  });

  it("selling the dev buy back at once returns 2.9403 SOL and the initial state", () => {
    const curve = new BondingCurve(P);
    const bought = curve.buy(3).tokensOut;
    const quote = curve.sell(bought);
    expectClose(quote.solOut, 2.9403);
    expectClose(quote.solOutGross, 2.97);
    expectClose(quote.fee, 0.0297);
    const state = curve.state();
    expectClose(state.x, 30);
    expectClose(state.y, 1_073_000_000);
    expectClose(state.realTokens, 793_100_000);
    // price × tokens is not the value of a position (§6.2).
    expectClose(3.37689e-8 * bought, 3.264, 1e-3);
  });

  it("selling in two halves without a trade in between gives the same total", () => {
    const curve = new BondingCurve(P);
    const bought = curve.buy(3).tokensOut;
    const first = curve.sell(bought / 2);
    const second = curve.sell(bought / 2);
    expectClose(first.solOut, 1.53949, 1e-5);
    expectClose(second.solOut, 1.40081, 1e-5);
    expectClose(first.solOut + second.solOut, 2.9403);
  });

  it("caps a 200 SOL buy on a fresh curve at the real reserves and completes the curve", () => {
    const curve = new BondingCurve(P);
    const quote = curve.buy(200);
    expect(quote.capped).toBe(true);
    expect(quote.solIn).toBe(200);
    expect(quote.tokensOut).toBe(793_100_000);
    expectClose(quote.solUsed, 85.864, 1e-4);
    expectClose(quote.solUsed - quote.fee, 85.0053, 1e-5);
    const state = curve.state();
    expectClose(state.x, 115.005, 1e-5);
    expectClose(state.y, 279_900_000);
    expect(state.realTokens).toBe(0);
    expectClose(state.price, 4.1088e-7, 1e-4);
    expectClose(marketCapSol(state, P), 410.88, 1e-4);
    expect(curveProgress(state, P)).toBe(1);
    expect(curve.isComplete()).toBe(true);
    expect(() => curve.buy(1)).toThrow(CurveCompleteError);
    expect(devBuySupplyShare(P, 200)).toMatchObject({ tokens: 793_100_000, capped: true });
  });

  it("computes the stable forms exactly like the literal formulas of §7.1", () => {
    const curve = new BondingCurve(P);
    curve.buy(2.5);
    const { x, y } = curve.state();
    const k = x * y;
    const sNet = 0.7 * 0.99;
    expectClose(curve.quoteBuy(0.7).tokensOut, y - k / (x + sNet), 1e-12);
    const t = 10_000_000;
    expectClose(curve.quoteSell(t).solOutGross, x - k / (y + t), 1e-12);
    expectClose(curve.quoteSell(t).solOut, (x - k / (y + t)) * 0.99, 1e-12);
  });

  it("keeps k constant and realTokens within bounds over 10 000 random trades", () => {
    const curve = new BondingCurve(P);
    const k = 30 * 1_073_000_000;
    const rng = createRng(18);
    let held = 0;
    for (let i = 0; i < 10_000; i += 1) {
      if (curve.isComplete() || held <= DUST_TOKENS || rng.next() < 0.55) {
        if (curve.isComplete()) break;
        held += curve.buy(0.01 + rng.next() * 2).tokensOut;
      } else {
        const tokens = held * rng.next();
        if (tokens > 0) held -= curve.sell(tokens).tokensIn;
      }
      const state = curve.state();
      expectClose(state.x * state.y, k, 1e-12);
      expect(state.realTokens).toBeGreaterThanOrEqual(0);
      expect(state.realTokens).toBeLessThanOrEqual(P.realTokens);
      // Float drift on token amounts: within a thousandth of a token (V1-19 tolerance).
      expect(Math.abs(curve.circulatingTokens() - held)).toBeLessThanOrEqual(1e-3);
    }
  });

  it("quotes without any side effect", () => {
    const curve = new BondingCurve(P);
    curve.buy(1);
    const before = curve.state();
    curve.quoteBuy(5);
    curve.quoteSell(1_000_000);
    curve.tokensForGrossSolOut(0.5);
    expect(curve.state()).toEqual(before);
    expect(curve.clone().state()).toEqual(before);
  });

  it("inverts a sell with tokensForGrossSolOut", () => {
    const curve = new BondingCurve(P);
    curve.buy(5);
    const tokens = curve.tokensForGrossSolOut(1.5);
    expectClose(curve.quoteSell(tokens).solOutGross, 1.5, 1e-12);
    // No finite amount drains the reserve.
    expect(curve.tokensForGrossSolOut(curve.state().x)).toBe(Infinity);
    expect(curve.tokensForGrossSolOut(1_000)).toBe(Infinity);
    expect(() => curve.tokensForGrossSolOut(0)).toThrow(RangeError);
  });

  it("brings a sell within DUST_TOKENS of the circulation back to it, refuses beyond", () => {
    const curve = new BondingCurve(P);
    const bought = curve.buy(3).tokensOut;
    expectClose(curve.quoteSell(bought + DUST_TOKENS / 2).tokensIn, bought, 1e-12);
    expect(() => curve.sell(bought + 1)).toThrow(RangeError);
    curve.sell(bought + DUST_TOKENS / 2);
    expect(Math.abs(curve.circulatingTokens())).toBeLessThanOrEqual(DUST_TOKENS);
  });

  it("refuses amounts that are not finite numbers > 0", () => {
    const curve = new BondingCurve(P);
    for (const amount of [0, -1, NaN, Infinity]) {
      expect(() => curve.quoteBuy(amount)).toThrow(RangeError);
      expect(() => curve.quoteSell(amount)).toThrow(RangeError);
      expect(() => curve.buy(amount)).toThrow(RangeError);
    }
  });

  it("restores a state and validates it", () => {
    const source = new BondingCurve(P);
    source.buy(4);
    const restored = new BondingCurve(P, source.state());
    expect(restored.state()).toEqual(source.state());
    expect(() => new BondingCurve(P, { ...source.state(), realTokens: -1 })).toThrow(RangeError);
    expect(() => new BondingCurve(P, { ...source.state(), x: 0 })).toThrow(RangeError);
  });
});

describe("assertCurveParams", () => {
  it("accepts the fallback params and names the field at fault otherwise", () => {
    expect(() => assertCurveParams(P)).not.toThrow();
    expect(() => assertCurveParams(null)).toThrow(RangeError);
    expect(() => assertCurveParams({ ...P, virtualSol: 0 })).toThrow(/virtualSol/);
    expect(() => assertCurveParams({ ...P, virtualTokens: NaN })).toThrow(/virtualTokens/);
    expect(() => assertCurveParams({ ...P, realTokens: P.virtualTokens })).toThrow(/realTokens/);
    expect(() => assertCurveParams({ ...P, realTokens: 0 })).toThrow(/realTokens/);
    expect(() => assertCurveParams({ ...P, totalSupply: 1 })).toThrow(/totalSupply/);
    expect(() => assertCurveParams({ ...P, feeRate: 1 })).toThrow(/feeRate/);
    expect(() => assertCurveParams({ ...P, feeRate: -0.1 })).toThrow(/feeRate/);
    expect(() => assertCurveParams({ ...P, feeRate: "0.01" })).toThrow(/feeRate/);
  });

  it("marketCapSol and curveProgress follow the state", () => {
    const curve = new BondingCurve(P);
    curve.buy(10);
    const state = curve.state();
    expectClose(marketCapSol(state, P), state.price * 1e9);
    expectClose(curveProgress(state, P), 266_233_082.71 / 793_100_000, 1e-9);
  });
});
