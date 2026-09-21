import { createHmac, timingSafeEqual } from "node:crypto";
import { INIT_DATA_CLOCK_SKEW_SEC, telegramIdSchema } from "@launchbot/shared";
import { z } from "zod";

/** Logged at debug level only; the client always gets the same 401. */
export type InitDataFailure = "missing" | "malformed" | "bad_hash" | "expired" | "no_user";

export type TelegramWebAppUser = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
};

export type InitDataResult =
  { ok: true; user: TelegramWebAppUser; authDate: Date } | { ok: false; reason: InitDataFailure };

/** The `user` field as Telegram serializes it, renamed to the shape the routes use. */
const userSchema = z
  .object({
    id: telegramIdSchema,
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    language_code: z.string().optional(),
  })
  .transform((user): TelegramWebAppUser => ({
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    languageCode: user.language_code,
  }));

const SHA256_HEX = /^[0-9a-f]{64}$/;

const hmac = (key: string | Buffer, message: string): Buffer =>
  createHmac("sha256", key).update(message).digest();

/**
 * The signature Telegram puts on the fields it hands to a Mini App ("Validating data received
 * via the Mini App"): every field but `hash`, sorted by key, one `key=value` per line, signed
 * with HMAC_SHA256(key "WebAppData", message BOT_TOKEN). A `signature` field, when present,
 * is part of the signed string like any other.
 */
export function signDataCheckString(params: URLSearchParams, botToken: string): Buffer {
  const fields = new URLSearchParams(params);
  fields.delete("hash");
  fields.sort();
  const dataCheckString = [...fields].map(([key, value]) => `${key}=${value}`).join("\n");
  return hmac(hmac("WebAppData", botToken), dataCheckString);
}

/**
 * Pure: authenticates the raw `X-Telegram-Init-Data` header. Data signed for another bot, or
 * altered after signature, fails like a wrong hash. The client-side `initDataUnsafe` is never
 * trusted: only this string is.
 */
export function validateInitData(
  raw: string | undefined,
  botToken: string,
  options: { maxAgeSec: number; now?: Date },
): InitDataResult {
  if (raw === undefined || raw === "") return { ok: false, reason: "missing" };

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (hash === null || !SHA256_HEX.test(hash)) return { ok: false, reason: "malformed" };

  // Same length by construction (32 bytes): timingSafeEqual cannot throw.
  if (!timingSafeEqual(Buffer.from(hash, "hex"), signDataCheckString(params, botToken))) {
    return { ok: false, reason: "bad_hash" };
  }

  // A missing field gives Number(null), which is 0 and refused like any date that is not one.
  const authDateSec = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDateSec) || authDateSec <= 0) {
    return { ok: false, reason: "malformed" };
  }
  const ageSec = (options.now ?? new Date()).getTime() / 1000 - authDateSec;
  // Too old, or from a future no clock drift explains.
  if (ageSec > options.maxAgeSec || ageSec < -INIT_DATA_CLOCK_SKEW_SEC) {
    return { ok: false, reason: "expired" };
  }

  try {
    const user = userSchema.parse(JSON.parse(params.get("user") ?? ""));
    return { ok: true, user, authDate: new Date(authDateSec * 1000) };
  } catch {
    // Absent, not JSON, or not the shape of a Telegram user.
    return { ok: false, reason: "no_user" };
  }
}
