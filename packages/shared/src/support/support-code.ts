import type { Plan } from "../constants.js";
import { isTelegramUsername } from "../token/fields.js";

// The support code of §11.1 (V1-40): what a user pastes at the start of a message to support,
// and what the admin commands read back (/grant, /whois, /getall, /purge). Pure functions.

/** `P`: Premium active, `C`: Classic active, `F`: no active plan. */
export type PlanLetter = "P" | "C" | "F";

const PLAN_LETTERS = { PREMIUM: "P", CLASSIC: "C" } as const satisfies Record<Plan, PlanLetter>;

/**
 * An account named by an admin. The letter is only what the code claimed: it can be older than
 * the plan (a code copied before an expiry), so the commands always read the plan again.
 */
export type UserRef = { telegramId: bigint; claimedPlanLetter: PlanLetter | null };

/** `P-123456789`: the letter of the active plan, then the Telegram id — never the id of the base. */
export const buildSupportCode = (plan: Plan | null, telegramId: bigint | number): string =>
  `${plan === null ? "F" : PLAN_LETTERS[plan]}-${BigInt(telegramId).toString()}`;

/** A Telegram id has 52 significant bits at most: 16 digits, no leading zero. */
const TELEGRAM_ID = /^[1-9]\d{0,15}$/;
const SUPPORT_CODE = /^([PCF])-(.*)$/i;

/** A Telegram id written in digits (a support code, the data of a button), else `null`. */
export const parseTelegramId = (raw: string): bigint | null =>
  TELEGRAM_ID.test(raw) ? BigInt(raw) : null;

/**
 * `123456789` or a support code, `P-123456789`, `c-123456789` (case ignored). `null` for anything
 * else: another letter, no dash, a space, a username, 0, a sign, 17 digits.
 */
export function parseUserRef(raw: string): UserRef | null {
  const trimmed = raw.trim();
  const code = SUPPORT_CODE.exec(trimmed);
  const telegramId = parseTelegramId(code === null ? trimmed : (code[2] ?? ""));
  if (telegramId === null) return null;
  const letter = code?.[1]?.toUpperCase() as PlanLetter | undefined;
  return { telegramId, claimedPlanLetter: letter ?? null };
}

const TELEGRAM_HOSTS = new Set(["t.me", "telegram.me", "telegram.dog"]);
/** Telegram gives a bot a username that ends in `bot`, and no user one that does. */
const BOT_USERNAME = /bot$/i;
/** What `?start=` accepts (Telegram deep links). */
const START_PARAMETER = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The Contact support button (§11.1). A `t.me/<username>` link gets the code as the first
 * message: `?text=` for a person, `?start=` for a bot. An invitation, any other path, another
 * site or `prefill: false` leave the link as it is: the code is on the screen anyway. The code
 * is encoded with `encodeURIComponent`, not `URLSearchParams`, which writes spaces as `+`.
 */
export function buildSupportUrl(
  baseUrl: string,
  code: string,
  options: { prefill: boolean },
): string {
  if (!options.prefill) return baseUrl;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  if (url.protocol !== "https:" || !TELEGRAM_HOSTS.has(url.hostname.toLowerCase())) return baseUrl;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const [username = ""] = segments;
  if (segments.length !== 1 || !isTelegramUsername(username)) return baseUrl;

  const isBot = BOT_USERNAME.test(username);
  if (isBot && !START_PARAMETER.test(code)) return baseUrl;
  const parameter = `${isBot ? "start" : "text"}=${encodeURIComponent(code)}`;
  const query = url.search === "" ? `?${parameter}` : `${url.search}&${parameter}`;
  return `${url.origin}${url.pathname}${query}${url.hash}`;
}
