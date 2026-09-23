import { z } from "zod";
import {
  TOKEN_DESCRIPTION_MAX_CHARS,
  TOKEN_DESCRIPTION_MAX_SENTENCES,
  TOKEN_NAME_MAX_BYTES,
  TOKEN_TICKER_MAX_BYTES,
  TOKEN_URL_MAX_LENGTH,
} from "../constants.js";
import {
  codePointLength,
  collapseSpaces,
  hasControlChars,
  utf8ByteLength,
} from "../format/text.js";

export type TokenField = "name" | "ticker" | "description" | "website" | "x" | "telegram";
export const TOKEN_FIELDS = [
  "name",
  "ticker",
  "description",
  "website",
  "x",
  "telegram",
] as const satisfies readonly TokenField[];

export type TokenFieldErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "TOO_MANY_SENTENCES"
  | "INVALID_CHARS"
  | "HAS_SPACES"
  | "NOT_HTTPS"
  | "INVALID_URL"
  | "INVALID_X"
  | "INVALID_TELEGRAM";

/** Typed, no text: V1-16 writes the English messages in en.ts from the code and the numbers. */
export type TokenFieldError = {
  field: TokenField;
  code: TokenFieldErrorCode;
  max?: number;
  actual?: number;
  unit?: "bytes" | "chars" | "sentences";
};

export type FieldResult = { ok: true; value: string } | { ok: false; error: TokenFieldError };

export type GeneratedToken = { name: string; symbol: string; description: string };

const ok = (value: string): FieldResult => ({ ok: true, value });
const fail = (error: TokenFieldError): FieldResult => ({ ok: false, error });
const tooLong = (
  field: TokenField,
  actual: number,
  max: number,
  unit: TokenFieldError["unit"],
): FieldResult => fail({ field, code: "TOO_LONG", max, actual, unit });

// --- Common normalization (proposal) -------------------------------------------------------

const LINE_BREAKS_AND_TABS = /[\r\n\t\v\f]+/g;

/**
 * The steps every field shares: NFC, line breaks and tabs as spaces, one space between words,
 * trimmed; any other control character is refused, never silently dropped.
 */
function common(field: TokenField, raw: string): FieldResult {
  const value = collapseSpaces(raw.normalize("NFC").replace(LINE_BREAKS_AND_TABS, " "));
  if (hasControlChars(value)) return fail({ field, code: "INVALID_CHARS" });
  if (value === "") return fail({ field, code: "EMPTY" });
  return ok(value);
}

// --- Name, ticker, description --------------------------------------------------------------

/** 1 to 32 bytes after NFC, case kept, `<` and `&` stored raw (escaped by the screen template). */
export function parseName(raw: string): FieldResult {
  const r = common("name", raw);
  if (!r.ok) return r;
  const actual = utf8ByteLength(r.value);
  return actual > TOKEN_NAME_MAX_BYTES ? tooLong("name", actual, TOKEN_NAME_MAX_BYTES, "bytes") : r;
}

/**
 * Leading `$` removed, upper case, NFC again, then 1 to 10 bytes: upper-casing can grow a text
 * (`ΐ` 2 bytes → 4, `ß` → `SS`), so the measure comes last. Stored without `$`.
 */
export function parseTicker(raw: string): FieldResult {
  const r = common("ticker", raw);
  if (!r.ok) return r;
  const value = r.value.replace(/^\$+/, "").toUpperCase().normalize("NFC").trim();
  if (value === "") return fail({ field: "ticker", code: "EMPTY" });
  if (value.includes(" ")) return fail({ field: "ticker", code: "HAS_SPACES" });
  const actual = utf8ByteLength(value);
  if (actual > TOKEN_TICKER_MAX_BYTES)
    return tooLong("ticker", actual, TOKEN_TICKER_MAX_BYTES, "bytes");
  return ok(value);
}

/** Ends of sentences: `.`, `!`, `?` or `…` followed by a space or the end. `moon.com` is no cut. */
const SENTENCE_END = /[.!?…]+(?=\s|$)/u;

export const countSentences = (text: string): number =>
  text.split(SENTENCE_END).filter((part) => part.trim() !== "").length;

/** 1 to 3 sentences, 280 code points at most (proposal). */
export function parseDescription(raw: string): FieldResult {
  const r = common("description", raw);
  if (!r.ok) return r;
  const chars = codePointLength(r.value);
  if (chars > TOKEN_DESCRIPTION_MAX_CHARS) {
    return tooLong("description", chars, TOKEN_DESCRIPTION_MAX_CHARS, "chars");
  }
  const sentences = countSentences(r.value);
  if (sentences > TOKEN_DESCRIPTION_MAX_SENTENCES) {
    return fail({
      field: "description",
      code: "TOO_MANY_SENTENCES",
      max: TOKEN_DESCRIPTION_MAX_SENTENCES,
      actual: sentences,
      unit: "sentences",
    });
  }
  return r;
}

// --- Links ----------------------------------------------------------------------------------

const HTTPS = /^https:\/\//i;
/** `scheme:` at the start, as WHATWG reads it. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** `new URL()` without the throw; a host is required. */
function parseUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    return url.hostname === "" ? null : url;
  } catch {
    return null;
  }
}

/** `https://` only (§5), a real host with a dot, no credentials; `https://Moon.com/` → `https://moon.com`. */
export function parseWebsite(raw: string): FieldResult {
  const r = common("website", raw);
  if (!r.ok) return r;
  const text = r.value;
  if (!HTTPS.test(text)) return fail({ field: "website", code: "NOT_HTTPS" });
  const actual = codePointLength(text);
  if (actual > TOKEN_URL_MAX_LENGTH)
    return tooLong("website", actual, TOKEN_URL_MAX_LENGTH, "chars");
  const url = parseUrl(text);
  if (url === null || url.username !== "" || url.password !== "" || !url.hostname.includes(".")) {
    return fail({ field: "website", code: "INVALID_URL" });
  }
  const bare = url.pathname === "/" && url.search === "" && url.hash === "";
  return ok(bare ? url.href.slice(0, -1) : url.href);
}

/** A handle or a link, read as a URL: `x.com/moonotter` gets `https://` first (proposal). */
function asUrl(text: string): URL | null {
  if (HAS_SCHEME.test(text)) return /^https?:\/\//i.test(text) ? parseUrl(text) : null;
  return parseUrl(`https://${text}`);
}

/** Path segments without the empty ones: `/moonotter/` → `["moonotter"]`. */
const segmentsOf = (url: URL): string[] => url.pathname.split("/").filter((s) => s !== "");

const X_HOSTS = new Set(["x.com", "twitter.com"]);
const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const X_RESERVED = new Set([
  "home",
  "explore",
  "search",
  "i",
  "settings",
  "messages",
  "notifications",
  "intent",
  "share",
]);
const X_COMMUNITY_ID = /^[0-9]+$/;

/** `www.x.com`, `mobile.twitter.com` → `x.com`, `twitter.com`. */
const bareHost = (url: URL): string => url.hostname.toLowerCase().replace(/^(www|mobile)\./, "");

const xHandle = (handle: string): FieldResult =>
  X_HANDLE.test(handle) && !X_RESERVED.has(handle.toLowerCase())
    ? ok(`https://x.com/${handle}`)
    : fail({ field: "x", code: "INVALID_X" });

/**
 * `moonotter`, `@moonotter`, `x.com/moonotter/`, `https://twitter.com/moonotter?s=21` →
 * `https://x.com/moonotter`; a community `x.com/i/communities/<digits>` is kept (proposal).
 * Query and hash dropped, case of the handle kept.
 */
export function parseX(raw: string): FieldResult {
  const r = common("x", raw);
  if (!r.ok) return r;
  const text = r.value;
  if (text.startsWith("@")) return xHandle(text.slice(1));
  if (X_HANDLE.test(text)) return xHandle(text);
  const url = asUrl(text);
  if (url === null || !X_HOSTS.has(bareHost(url))) return fail({ field: "x", code: "INVALID_X" });
  const segments = segmentsOf(url);
  if (segments.length === 3 && segments[0] === "i" && segments[1] === "communities") {
    const id = segments[2] ?? "";
    return X_COMMUNITY_ID.test(id)
      ? ok(`https://x.com/i/communities/${id}`)
      : fail({ field: "x", code: "INVALID_X" });
  }
  if (segments.length !== 1) return fail({ field: "x", code: "INVALID_X" });
  return xHandle(segments[0] ?? "");
}

const TELEGRAM_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);
/** 5 to 32 characters, a letter first, no `_` last (Telegram's rule). */
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/;
const TELEGRAM_INVITE = /^[A-Za-z0-9_-]{16,}$/;
/** Paths of t.me that are features, not usernames (proposal). */
const TELEGRAM_RESERVED = new Set([
  "joinchat",
  "addstickers",
  "addemoji",
  "addtheme",
  "share",
  "proxy",
  "socks",
  "setlanguage",
  "confirmphone",
  "login",
  "contact",
  "invoice",
  "boost",
  "giftcode",
]);

const invalidTelegram = (): FieldResult => fail({ field: "telegram", code: "INVALID_TELEGRAM" });

const telegramUsername = (name: string): FieldResult =>
  TELEGRAM_USERNAME.test(name) && !TELEGRAM_RESERVED.has(name.toLowerCase())
    ? ok(`https://t.me/${name}`)
    : invalidTelegram();

/**
 * `t.me/name`, `https://telegram.me/name`, `@name` → `https://t.me/name`; invitations
 * `t.me/+<hash>` and `t.me/joinchat/<hash>` → `https://t.me/+<hash>`. Other domains and deeper
 * paths (`t.me/name/123`) are refused.
 */
export function parseTelegram(raw: string): FieldResult {
  const r = common("telegram", raw);
  if (!r.ok) return r;
  const text = r.value;
  if (text.startsWith("@")) return telegramUsername(text.slice(1));
  const url = asUrl(text);
  if (url === null || !TELEGRAM_HOSTS.has(bareHost(url))) return invalidTelegram();
  const [first = "", second = "", ...rest] = segmentsOf(url);
  if (rest.length > 0 || first === "") return invalidTelegram();
  const invite =
    first.startsWith("+") && second === "" ? first.slice(1) : first === "joinchat" ? second : null;
  if (invite !== null) {
    return TELEGRAM_INVITE.test(invite) ? ok(`https://t.me/+${invite}`) : invalidTelegram();
  }
  return second === "" ? telegramUsername(first) : invalidTelegram();
}

// --- Entry points -----------------------------------------------------------------------------

const PARSERS = {
  name: parseName,
  ticker: parseTicker,
  description: parseDescription,
  website: parseWebsite,
  x: parseX,
  telegram: parseTelegram,
} as const satisfies Record<TokenField, (raw: string) => FieldResult>;

/** The normalized value of a field, or its typed error. */
export const parseTokenField = (field: TokenField, raw: string): FieldResult => PARSERS[field](raw);

/**
 * A field as a zod schema: the issue carries the `TokenFieldError` in `params`, and
 * `tokenFieldErrorOf` reads it back from a `ZodError`.
 */
const schemaOf = (field: TokenField) =>
  z.string().transform((raw, ctx) => {
    const result = PARSERS[field](raw);
    if (result.ok) return result.value;
    ctx.addIssue({ code: "custom", message: result.error.code, params: result.error });
    return z.NEVER;
  });

export const tokenNameSchema = schemaOf("name");
export const tokenTickerSchema = schemaOf("ticker");
export const tokenDescriptionSchema = schemaOf("description");
export const tokenWebsiteSchema = schemaOf("website");
export const tokenXSchema = schemaOf("x");
export const tokenTelegramSchema = schemaOf("telegram");

/** The first field error of a `ZodError` produced by the schemas above, if any. */
export function tokenFieldErrorOf(error: z.ZodError): TokenFieldError | null {
  for (const issue of error.issues) {
    if (issue.code === "custom" && issue.params && "field" in issue.params) {
      return issue.params as TokenFieldError;
    }
  }
  return null;
}

/** What Generate and AI Generate must produce: a name, a ticker and a description all valid. */
export const generatedTokenSchema: z.ZodType<GeneratedToken, GeneratedToken> = z.object({
  name: tokenNameSchema,
  symbol: tokenTickerSchema,
  description: tokenDescriptionSchema,
});

/** The draft as the Mini App receives it (V1-23); `hasImage` becomes an image URI in V2-02. */
export const tokenDraftPublicSchema = z.object({
  name: z.string().nullable(),
  symbol: z.string().nullable(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  twitter: z.string().nullable(),
  telegram: z.string().nullable(),
  hasImage: z.boolean(),
});
export type TokenDraftPublic = z.infer<typeof tokenDraftPublicSchema>;
