import { z } from "zod";
import { isCallbackDataSize } from "./callback.js";
import {
  DEV_BUY_MAX_DECIMALS,
  DEV_BUY_MAX_SOL,
  DEV_BUY_MIN_SOL,
  DURATIONS,
  LAMPORTS_PER_SOL,
  PLANS,
  TG,
  WALLET_NAME_MAX_CHARS,
} from "./constants.js";
import { parseSolToLamports } from "./format/sol.js";
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

/**
 * Dev buy → lamports. §15: a Custom dev buy outside 1 to 20 SOL is refused, in simulation
 * as in launch.
 */
export const devBuySolSchema = solAmountInputSchema.refine(
  (lamports) =>
    lamports >= BigInt(DEV_BUY_MIN_SOL) * LAMPORTS_PER_SOL &&
    lamports <= BigInt(DEV_BUY_MAX_SOL) * LAMPORTS_PER_SOL,
  `Must be from ${DEV_BUY_MIN_SOL} to ${DEV_BUY_MAX_SOL} SOL`,
);

export const httpsUrlSchema = z.url({ protocol: /^https$/ });

// Spaces anywhere, a comma as decimal separator, an optional SOL suffix; no sign, no exponent.
const DEV_BUY_INPUT = new RegExp(
  `^(\\d{1,2})(?:[.,](\\d{1,${DEV_BUY_MAX_DECIMALS}}))?(?:sol)?$`,
  "i",
);

/**
 * A Custom dev buy typed by the user (§6, §15): `1`, `2.5`, `2,5`, `5 sol`, `1.125`, from
 * 1 to 20 SOL with 3 decimals at most (proposal). The amount is a number, as `SimConfig`
 * holds it (§7.4).
 */
export function parseDevBuyAmount(text: string): { ok: true; sol: number } | { ok: false } {
  const match = DEV_BUY_INPUT.exec(text.replace(/\s+/g, ""));
  if (match === null) return { ok: false };
  const [, integer = "0", fraction = ""] = match;
  const sol = Number(`${integer}.${fraction === "" ? "0" : fraction}`);
  return sol >= DEV_BUY_MIN_SOL && sol <= DEV_BUY_MAX_SOL ? { ok: true, sol } : { ok: false };
}

/** `parseDevBuyAmount` as a schema: the typed text → SOL number. */
export const devBuyAmountSchema = z.string().transform((text, ctx) => {
  const parsed = parseDevBuyAmount(text);
  if (!parsed.ok) {
    ctx.addIssue({
      code: "custom",
      message: `Must be from ${DEV_BUY_MIN_SOL} to ${DEV_BUY_MAX_SOL} SOL, ${DEV_BUY_MAX_DECIMALS} decimals max`,
    });
    return z.NEVER;
  }
  return parsed.sol;
});

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
 * `SimConfig` of the engine (§7.4), as stored in `Simulation.params` (V1-22), answered by
 * the API (V1-23) and checked by the Mini App (V1-24). `assertSimConfig` of the engine is the
 * other half: this schema is what crosses a JSON boundary.
 */
export const simConfigSchema = z.object({
  seed: seedSchema,
  devBuySol: z.number().min(DEV_BUY_MIN_SOL).max(DEV_BUY_MAX_SOL),
  durationSec: z.int().positive(),
  curve: curveParamsSchema,
  preset: presetParamsSchema,
  solUsdPrice: z.number().finite().positive().nullable(),
});
export type SimConfigJson = z.infer<typeof simConfigSchema>;

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
