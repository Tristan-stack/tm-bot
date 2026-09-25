import { z } from "zod";
import { isCallbackDataSize } from "./callback.js";
import {
  BUNDLE_LAMPORT_UNIT,
  BUNDLE_MAX_LAMPORTS,
  BUNDLE_MIN_LAMPORTS,
  DURATIONS,
  PLANS,
  TG,
  WALLET_NAME_MAX_CHARS,
} from "./constants.js";
import { lamportsToSol, parseSolToLamports } from "./format/sol.js";
import { codePointLength, collapseSpaces, hasControlChars } from "./format/text.js";

/** Telegram ids fit in 52 bits: a safe integer. */
export const telegramIdSchema = z.int().positive();

/** Prisma `cuid()` ids (V1-02). */
export const idSchema = z.cuid();

export const planSchema = z.enum(PLANS);
export const durationSchema = z.enum(DURATIONS);

/** Typed SOL amount (`.` or `,`, 9 decimals max) → lamports, strictly positive. */
export const solAmountInputSchema = z
  .union([z.string(), z.number().transform(String)])
  .transform((input, ctx) => {
    const lamports = parseSolToLamports(input);
    if (lamports === null || lamports <= 0n) {
      ctx.addIssue({ code: "custom", message: "Must be a positive SOL amount, 9 decimals max" });
      return z.NEVER;
    }
    return lamports;
  });

export const httpsUrlSchema = z.url({ protocol: /^https$/ });

/**
 * A Custom bundle typed by the user (§6, §15, decision of 25/09/2026): the SOL grammar of
 * `parseSolToLamports` (`.` or `,`, an optional `sol` suffix, no sign, no exponent), from 3 to
 * 20 SOL with 3 decimals at most (proposal). The amount as a number, as `SimConfig` holds it
 * (§7.4), and as the exact lamports a launch pays (V1-36).
 */
export function parseBundleAmount(
  text: string,
): { ok: true; sol: number; lamports: bigint } | { ok: false } {
  const lamports = parseSolToLamports(text);
  if (
    lamports === null ||
    lamports % BUNDLE_LAMPORT_UNIT !== 0n ||
    lamports < BUNDLE_MIN_LAMPORTS ||
    lamports > BUNDLE_MAX_LAMPORTS
  ) {
    return { ok: false };
  }
  return { ok: true, sol: lamportsToSol(lamports), lamports };
}

const positive = z.number().finite().positive();

/** `CurveParams` of the engine (§7.1, §7.4): the same rules as `assertCurveParams`. */
export const curveParamsSchema = z
  .object({
    virtualSol: positive,
    virtualTokens: positive,
    realTokens: positive,
    totalSupply: positive,
    feeRate: z.number().min(0).lt(1),
  })
  .refine((c) => c.virtualTokens > c.realTokens, "virtualTokens must exceed realTokens")
  .refine((c) => c.totalSupply >= c.realTokens, "totalSupply must cover realTokens");

/** `PresetParams` of the engine (§7.3, §7.4). */
export const presetParamsSchema = z
  .object({
    lambda0: positive,
    pBuy: z.number().min(0).max(1),
    mu: z.number().finite(),
    sigma: positive,
    minTrade: positive,
    maxTrade: positive,
  })
  .refine((p) => p.maxTrade >= p.minTrade, "maxTrade must be at least minTrade");

/** A seed of the engine: a uint32 (V1-18); V1-22 draws it below 2^31 for the Int of Prisma. */
export const seedSchema = z.int().min(0).max(0xffffffff);

/**
 * `SimConfig` of the engine (§7.4), as stored in `Simulation.params` (V1-22) and read back by
 * the bot to run the simulation (V1-26). `assertSimConfig` of the engine is the other half:
 * this schema is what crosses the JSON boundary of the database, with the same rules, never
 * the bounds of an input (those are `parseBundleAmount`'s), so a stored row stays readable.
 */
export const simConfigSchema = z.object({
  seed: seedSchema,
  devBuySol: positive,
  // No bundle in the rows made before it (decision of 25/09/2026).
  bundleSol: z.number().finite().min(0).default(0),
  durationSec: z.int().positive(),
  curve: curveParamsSchema,
  preset: presetParamsSchema,
  solUsdPrice: z.number().finite().positive().nullable(),
});

/** The words of the error bodies of the API (V1-05): `{ "error": "<code>" }`. */
export const API_ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "internal",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export const apiErrorSchema = z.object({ error: z.enum(API_ERROR_CODES) });

/** Trim, one space between words. Line breaks are not spaces here: they are refused below. */
export const normalizeWalletName = collapseSpaces;

export type WalletNameIssue =
  | { reason: "empty" }
  | { reason: "too_long"; length: number }
  /** A line break or a control character (proposal). */
  | { reason: "invalid" };

/**
 * The rule of a wallet name (§9.3): 1 to 32 characters, counted in code points (an emoji is
 * one, proposal), on one line. Uniqueness is the service's business. Not a zod schema: the
 * caller wants the reason, and a schema would carry it through the human message channel.
 */
export function walletNameIssue(raw: string): WalletNameIssue | null {
  if (hasControlChars(raw)) return { reason: "invalid" };
  const name = normalizeWalletName(raw);
  if (name === "") return { reason: "empty" };
  const length = codePointLength(name);
  if (length > WALLET_NAME_MAX_CHARS) return { reason: "too_long", length };
  return null;
}

export const callbackDataSchema = z
  .string()
  .refine(isCallbackDataSize, `Must be 1 to ${TG.CALLBACK_DATA_MAX_BYTES} bytes`);
