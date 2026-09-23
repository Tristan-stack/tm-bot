import { LAMPORTS_PER_SOL, SOL_DECIMALS } from "../constants.js";
import { formatMagnitude, trimTrailingZeros } from "./number.js";

export type SolRounding = "floor" | "ceil" | "halfUp";
export type FormatSolOptions = {
  /** 0 to 9, 3 by default. Invoices use 4. */
  decimals?: number;
  /** `floor` by default: a balance is never overstated. A missing amount uses `ceil`. */
  rounding?: SolRounding;
  /** Drops trailing zeros: `3`, `0.05`. */
  trim?: boolean;
  /** With `trim`, the decimals kept whatever the zeros: `{ trim: true, minDecimals: 3 }` → `1.250`. */
  minDecimals?: number;
};

/** `2.500`: SOL amount without its unit. Computed on lamports, never on floats. */
export function formatSolAmount(lamports: bigint, options: FormatSolOptions = {}): string {
  const { decimals = 3, rounding = "floor", trim = false, minDecimals = 0 } = options;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > SOL_DECIMALS) {
    throw new RangeError(`decimals must be an integer from 0 to ${SOL_DECIMALS}`);
  }
  const negative = lamports < 0n;
  const magnitude = negative ? -lamports : lamports;
  // Rounding applies to the magnitude: -1.2345 SOL floors to -1.234.
  const unit = 10n ** BigInt(SOL_DECIMALS - decimals);
  const remainder = magnitude % unit;
  let scaled = magnitude / unit;
  if (
    (rounding === "ceil" && remainder > 0n) ||
    (rounding === "halfUp" && remainder * 2n >= unit)
  ) {
    scaled += 1n;
  }

  const digits = scaled.toString().padStart(decimals + 1, "0");
  const integer = digits.slice(0, digits.length - decimals);
  let text = decimals === 0 ? integer : `${integer}.${digits.slice(-decimals)}`;
  if (trim && decimals > 0) {
    const [whole = "0", fraction = ""] = trimTrailingZeros(text).split(".");
    const kept = fraction.padEnd(minDecimals, "0");
    text = kept === "" ? whole : `${whole}.${kept}`;
  }
  return negative && scaled > 0n ? `-${text}` : text;
}

/** `2.500 SOL`; `{ decimals: 4 }` → `0.5708 SOL`; `{ trim: true }` → `3 SOL`. */
export const formatSol = (lamports: bigint, options?: FormatSolOptions): string =>
  `${formatSolAmount(lamports, options)} SOL`;

/**
 * Exact to the lamport, for what is about to be sent or was charged (§9.5, V1-14): every
 * decimal that is not zero, and three at least, so that a fee reads `0.000005 SOL` and an
 * amount `1.250 SOL`, never `0.000 SOL`.
 */
export const formatSolExact = (lamports: bigint): string =>
  formatSol(lamports, { decimals: SOL_DECIMALS, trim: true, minDecimals: 3 });

const SOL_INPUT = /^(\d{1,10})(?:[.,](\d{1,9}))?(?:\s*sol)?$/i;

/**
 * Parses a typed amount: `.` or `,`, 9 decimals max, no sign, no exponent, the unit allowed
 * after the number (`1 SOL`, V1-14). `null` if invalid.
 */
export function parseSolToLamports(input: string): bigint | null {
  const match = SOL_INPUT.exec(input.trim());
  if (match === null) return null;
  const [, integer = "0", fraction = ""] = match;
  return BigInt(integer) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(SOL_DECIMALS, "0"));
}

/**
 * A SOL amount held as a number, 3 decimals at most (a dev buy, V1-22): `5 SOL`, `2.5 SOL`,
 * `1.125 SOL`. Never for a balance, which is lamports.
 */
export const formatSolNumber = (sol: number): string =>
  formatSol(BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL))), { trim: true });

/** `$1,234.56`, `$59.00` */
export const formatUsd = (value: number): string => {
  const text = formatMagnitude(value, 2);
  return value < 0 && text !== "0.00" ? `-$${text}` : `$${text}`;
};

/** USD value of a SOL amount, for display only. `null` when the SOL price is unknown (§4.3). */
export const usdOf = (lamports: bigint, solUsd: number | null): number | null =>
  solUsd === null ? null : (Number(lamports) / Number(LAMPORTS_PER_SOL)) * solUsd;

/** `2.500 SOL ($258.40)`, or `2.500 SOL` when the SOL price is unknown: USD amounts are hidden. */
export const withUsd = (solText: string, usd: number | null): string =>
  usd === null ? solText : `${solText} (${formatUsd(usd)})`;

/** The balance line of every screen: `formatSol` with its USD value, when there is a price. */
export const formatSolWithUsd = (lamports: bigint, solUsd: number | null): string =>
  withUsd(formatSol(lamports), usdOf(lamports, solUsd));

/** `SOL $103.36`, or `SOL —` when the price is unknown. */
export const formatSolPrice = (solUsd: number | null): string =>
  `SOL ${solUsd === null ? "—" : formatUsd(solUsd)}`;
