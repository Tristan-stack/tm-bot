export type TelegramApp = {
  apiId: number;
  apiHash: string;
};

export const CREDENTIAL_ERRORS = {
  id: "TELEGRAM_API_ID is missing or invalid",
  hash: "TELEGRAM_API_HASH is missing",
} as const;

const DIGITS = /^\d+$/;

/** `api_id` and `api_hash` from my.telegram.org. A failure names the variable and never its value. */
export function readTelegramApp(
  env: Record<string, string | undefined>,
): { ok: true; app: TelegramApp } | { ok: false; reason: string } {
  const apiId = env["TELEGRAM_API_ID"]?.trim() ?? "";
  const apiHash = env["TELEGRAM_API_HASH"]?.trim() ?? "";
  const id = Number(apiId);
  if (!DIGITS.test(apiId) || !Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, reason: CREDENTIAL_ERRORS.id };
  }
  if (apiHash === "") return { ok: false, reason: CREDENTIAL_ERRORS.hash };
  return { ok: true, app: { apiId: id, apiHash } };
}

/** A wrong code or password can be typed again. Anything else stops the sign-in. */
export function stopsSignIn(error: Error): boolean {
  return !/PHONE_CODE_INVALID|PHONE_CODE_EXPIRED|PASSWORD_HASH_INVALID/i.test(error.message);
}

/** Drops the api hash, the phone, the code and the password if a client error quotes them. */
export function publicError(error: unknown, secrets: readonly string[]): string {
  const message = error instanceof Error ? error.message : "";
  let safe = message === "" ? "Sign-in failed" : message;
  for (const secret of secrets) {
    // A login code is five digits. Shorter values would match unrelated text.
    if (secret.length >= 5) safe = safe.replaceAll(secret, "[REDACTED]");
  }
  const trimmed = safe.trim();
  return trimmed === "" ? "Sign-in failed" : trimmed;
}

/** What the command prints. The session is its own line, so it can be copied into `.env`. */
export function sessionInstructions(session: string): string {
  return `Add this to .env as TELEGRAM_SESSION. Do not commit it.\n\n${session}\n`;
}

/** Absent when the sign-in has not been done yet. */
export function readStoredSession(env: Record<string, string | undefined>): string | undefined {
  const session = env["TELEGRAM_SESSION"]?.trim() ?? "";
  return session === "" ? undefined : session;
}

/** Our default token image. An imported card never uses the source channel's photo. */
export function readDefaultImageUrl(env: Record<string, string | undefined>): string | undefined {
  const url = env["DEFAULT_TOKEN_IMAGE_URL"]?.trim() ?? "";
  if (url === "") return undefined;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** A message read from a public channel. `text` may be empty. A message with no unix date is skipped. */
export type SourceMessage = {
  id: number;
  text: string;
};

/** One GramJS message, without taking its `any` fields into our types. */
export function sourceMessageFrom(raw: {
  id: unknown;
  date: unknown;
  message: unknown;
}): SourceMessage | undefined {
  if (typeof raw.id !== "number" || !Number.isSafeInteger(raw.id) || raw.id < 0) return undefined;
  if (typeof raw.date !== "number" || !Number.isFinite(raw.date)) return undefined;
  return {
    id: raw.id,
    text: typeof raw.message === "string" ? raw.message : "",
  };
}
