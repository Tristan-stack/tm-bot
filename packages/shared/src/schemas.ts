import { z } from "zod";
import { isCallbackDataSize } from "./callback.js";
import {
  DEV_BUY_MAX_SOL,
  DEV_BUY_MIN_SOL,
  DURATIONS,
  LAMPORTS_PER_SOL,
  PLANS,
  TG,
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

export const callbackDataSchema = z
  .string()
  .refine(isCallbackDataSize, `Must be 1 to ${TG.CALLBACK_DATA_MAX_BYTES} bytes`);
