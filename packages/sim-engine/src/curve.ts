import { clamp } from "./dmath.js";
import {
  checkNumber,
  checkPositive,
  CurveCompleteError,
  isFinitePositive,
  isRecord,
  rangeError,
} from "./errors.js";
import type { CurveParams, CurveState } from "./types.js";

/** Values of the pump.fun `Global` account (§7.1), used when the devnet read fails (V1-21). */
export const FALLBACK_CURVE_PARAMS: Readonly<CurveParams> = Object.freeze({
  virtualSol: 30,
  virtualTokens: 1_073_000_000,
  realTokens: 793_100_000,
  totalSupply: 1_000_000_000,
  feeRate: 0.01,
});

export const TOKEN_DECIMALS = 6;

/** Float tolerance on token amounts: reserves at or under it count as empty (proposal). */
export const DUST_TOKENS = 1e-6;

/** A holding within the dust of zero is zero: applied wherever a holding is written. */
export const settleTokens = (tokens: number): number => (tokens <= DUST_TOKENS ? 0 : tokens);

export type BuyQuote = {
  /** SOL asked for. */
  solIn: number;
  /** SOL really paid, fees included: `solIn` unless the buy was capped. */
  solUsed: number;
  fee: number;
  tokensOut: number;
  /** The buy emptied the real reserves: the curve is complete. */
  capped: boolean;
  priceBefore: number;
  priceAfter: number;
};

export type SellQuote = {
  tokensIn: number;
  solOutGross: number;
  fee: number;
  /** SOL received, fees deducted. */
  solOut: number;
  priceBefore: number;
  priceAfter: number;
};

/** The five fields of §7.4, each finite and within the bounds of §7.1. */
export function assertCurveParams(params: unknown): asserts params is CurveParams {
  if (!isRecord(params)) throw rangeError("curve", "an object");
  checkPositive(params.virtualSol, "virtualSol");
  const virtualTokens = checkPositive(params.virtualTokens, "virtualTokens");
  const realTokens = checkNumber(
    params.realTokens,
    "realTokens",
    "a finite number > 0 and < virtualTokens",
    (n) => isFinitePositive(n) && n < virtualTokens,
  );
  checkNumber(
    params.totalSupply,
    "totalSupply",
    "a finite number ≥ realTokens",
    (n) => Number.isFinite(n) && n >= realTokens,
  );
  checkNumber(params.feeRate, "feeRate", "a number in [0, 1)", (n) => n >= 0 && n < 1);
}

/**
 * Constant-product curve on virtual reserves (§7.1). Fees are taken on the SOL paid at a
 * buy and on the SOL received at a sell, exactly as the context writes them: the real
 * on-chain model (integers, dynamic fees) is V2's concern.
 */
export class BondingCurve {
  readonly params: Readonly<CurveParams>;
  #x: number;
  #y: number;
  #realTokens: number;

  constructor(params: CurveParams, state?: CurveState) {
    assertCurveParams(params);
    this.params = Object.freeze({ ...params });
    if (state === undefined) {
      this.#x = params.virtualSol;
      this.#y = params.virtualTokens;
      this.#realTokens = params.realTokens;
      return;
    }
    this.#x = checkPositive(state.x, "state.x");
    this.#y = checkPositive(state.y, "state.y");
    this.#realTokens = checkNumber(
      state.realTokens,
      "state.realTokens",
      "a number in [0, realTokens]",
      (n) => n >= 0 && n <= params.realTokens,
    );
  }

  /** A copy: the caller cannot reach the reserves. */
  state(): CurveState {
    return { x: this.#x, y: this.#y, realTokens: this.#realTokens, price: this.price() };
  }

  price(): number {
    return this.#x / this.#y;
  }

  /** Tokens held outside the curve: the dev and the traders together. */
  circulatingTokens(): number {
    return this.params.realTokens - this.#realTokens;
  }

  isComplete(): boolean {
    return this.#realTokens <= DUST_TOKENS;
  }

  /**
   * The buy of `sol` SOL without applying it. Capped at the real reserves: the SOL that
   * would go past them is not spent (proposal) and the curve is then complete.
   */
  quoteBuy(sol: number): BuyQuote {
    checkPositive(sol, "sol");
    if (this.isComplete()) throw new CurveCompleteError();
    const f = this.params.feeRate;
    const x = this.#x;
    const y = this.#y;
    let solUsed = sol;
    let solNet = sol * (1 - f);
    // y − k/(x + s') written without the subtraction of two large numbers.
    let tokensOut = (y * solNet) / (x + solNet);
    let capped = false;
    if (tokensOut >= this.#realTokens) {
      tokensOut = this.#realTokens;
      solNet = (x * y) / (y - tokensOut) - x;
      solUsed = solNet / (1 - f);
      capped = true;
    }
    const fee = solUsed * f;
    return {
      solIn: sol,
      solUsed,
      fee,
      tokensOut,
      capped,
      priceBefore: x / y,
      priceAfter: (x + (solUsed - fee)) / (y - tokensOut),
    };
  }

  buy(sol: number): BuyQuote {
    const quote = this.quoteBuy(sol);
    this.#x += quote.solUsed - quote.fee;
    this.#y -= quote.tokensOut;
    // Capped: tokensOut is exactly the reserve, so this lands on 0.
    this.#realTokens -= quote.tokensOut;
    return quote;
  }

  /**
   * The sell of `tokens` without applying it: price impact and fees included, which is
   * why "value if sold now" goes through here and never through price × tokens (§6.2).
   * Within `DUST_TOKENS` of the circulating tokens, the amount is brought back to them.
   */
  quoteSell(tokens: number): SellQuote {
    checkPositive(tokens, "tokens");
    const circulating = this.circulatingTokens();
    if (tokens > circulating + DUST_TOKENS) {
      throw rangeError("tokens", `at most the ${circulating} tokens in circulation`);
    }
    const tokensIn = tokens > circulating ? circulating : tokens;
    const x = this.#x;
    const y = this.#y;
    // x − k/(y + t), in its stable form.
    const solOutGross = (x * tokensIn) / (y + tokensIn);
    const fee = solOutGross * this.params.feeRate;
    return {
      tokensIn,
      solOutGross,
      fee,
      solOut: solOutGross - fee,
      priceBefore: x / y,
      priceAfter: (x - solOutGross) / (y + tokensIn),
    };
  }

  sell(tokens: number): SellQuote {
    const quote = this.quoteSell(tokens);
    this.#x -= quote.solOutGross;
    this.#y += quote.tokensIn;
    this.#realTokens += quote.tokensIn;
    return quote;
  }

  /**
   * Inverse of the sell: the tokens whose sale takes `sol` SOL (gross) out of the curve.
   * No finite amount drains the reserve: `Infinity` at or past it.
   */
  tokensForGrossSolOut(sol: number): number {
    checkPositive(sol, "sol");
    if (sol >= this.#x) return Infinity;
    return (sol * this.#y) / (this.#x - sol);
  }

  clone(): BondingCurve {
    return new BondingCurve(this.params, this.state());
  }
}

export function marketCapSol(state: CurveState, params: CurveParams): number {
  return state.price * params.totalSupply;
}

/** Share of the real reserves sold, in [0, 1]. */
export function curveProgress(state: CurveState, params: CurveParams): number {
  return clamp(1 - state.realTokens / params.realTokens, 0, 1);
}

/** "Dev buy: 3 SOL (≈ 9.7% of supply)": the raw share, the screen picks the precision. */
export function devBuySupplyShare(
  params: CurveParams,
  devBuySol: number,
): { tokens: number; share: number; capped: boolean } {
  const quote = new BondingCurve(params).quoteBuy(devBuySol);
  return {
    tokens: quote.tokensOut,
    share: quote.tokensOut / params.totalSupply,
    capped: quote.capped,
  };
}
