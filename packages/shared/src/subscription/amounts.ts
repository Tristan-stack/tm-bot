import { SOL_USD_RATE_DECIMALS } from "../constants.js";

const RATE_SCALE = 10n ** BigInt(SOL_USD_RATE_DECIMALS);
/** Cents → lamports at a rate scaled by 10^8: cents / 100 × 10^9 × 10^8. */
const CENTS_TO_SCALED_LAMPORTS = 10n ** 15n;

/** The SOL/USD rate an invoice records and computes with: 8 decimals, like its column. */
export const formatSolUsdRate = (solUsd: number): string => solUsd.toFixed(SOL_USD_RATE_DECIMALS);

function scaledRate(rate: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rate);
  const decimals = match?.[2] ?? "";
  if (match?.[1] === undefined || decimals.length > SOL_USD_RATE_DECIMALS) {
    throw new RangeError(`Not a SOL/USD rate with ${SOL_USD_RATE_DECIMALS} decimals at most`);
  }
  return BigInt(match[1]) * RATE_SCALE + BigInt(decimals.padEnd(SOL_USD_RATE_DECIMALS, "0"));
}

/**
 * The lamports an invoice expects (§8.3): the USD price at the recorded rate, rounded up to the
 * lamport, in integers only. $59 at 103.36 → 570 820 434. A screen shows it with
 * `formatSol(lamports, { decimals: 4, rounding: "ceil" })`, « 0.5709 SOL »: never below what is
 * expected (DEC-06, validated on 24/09/2026).
 */
export function computeExpectedLamports(priceUsdCents: number, solUsdRate: string): bigint {
  const rate = scaledRate(solUsdRate);
  if (rate <= 0n) throw new RangeError("The SOL/USD rate must be positive");
  const scaled = BigInt(priceUsdCents) * CENTS_TO_SCALED_LAMPORTS;
  return (scaled + rate - 1n) / rate;
}
