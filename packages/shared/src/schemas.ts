import { z } from "zod";
import { isCallbackDataSize } from "./callback.js";
import {
  DEV_BUY_MAX_SOL,
  DEV_BUY_MIN_SOL,
  DURATIONS,
  LAMPORTS_PER_SOL,
  PLANS,
  TG,
  WALLET_NAME_MAX_CHARS,
} from "./constants.js";
import { parseSolToLamports } from "./format/sol.js";

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

/** Trim, one space between words. Line breaks are not spaces here: they are refused below. */
export const normalizeWalletName = (raw: string): string => raw.trim().replace(/ {2,}/g, " ");

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
  if (/\p{Cc}/u.test(raw)) return { reason: "invalid" };
  const name = normalizeWalletName(raw);
  if (name === "") return { reason: "empty" };
  const length = Array.from(name).length;
  if (length > WALLET_NAME_MAX_CHARS) return { reason: "too_long", length };
  return null;
}

export const callbackDataSchema = z
  .string()
  .refine(isCallbackDataSize, `Must be 1 to ${TG.CALLBACK_DATA_MAX_BYTES} bytes`);
