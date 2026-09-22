export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// Same values as the Prisma enums (V1-02).
export const PLANS = ["CLASSIC", "PREMIUM"] as const;
export type Plan = (typeof PLANS)[number];
export const DURATIONS = ["TWO_DAYS", "ONE_MONTH"] as const;
export type Duration = (typeof DURATIONS)[number];

// Subscribe (§8.1, §8.3, §8.4)
export const PRICES_USD = {
  CLASSIC: { TWO_DAYS: 49, ONE_MONTH: 169 },
  PREMIUM: { TWO_DAYS: 59, ONE_MONTH: 179 },
} as const satisfies Record<Plan, Record<Duration, number>>;
export const PLAN_DURATION_MS = {
  TWO_DAYS: 48 * HOUR_MS,
  ONE_MONTH: 30 * DAY_MS,
} as const satisfies Record<Duration, number>;
export const INVOICE_TTL_MS = 30 * MINUTE_MS;
export const LATE_PAYMENT_TOLERANCE_MS = 24 * HOUR_MS;
export const PAYMENT_CHECK_INTERVAL_MS = 15 * SECOND_MS;
export const DEPOSIT_WATCH_MS = 30 * DAY_MS;
export const REMINDER_BEFORE_MS = {
  ONE_MONTH: 24 * HOUR_MS,
  TWO_DAYS: 6 * HOUR_MS,
} as const satisfies Record<Duration, number>;
/** Under this remaining time the home screen shows `1d 4h left` instead of `until 12 Oct`. */
export const REMAINING_DETAIL_BELOW_MS = 72 * HOUR_MS;

// Wallets (§9.1). D1 validated on 16/09/2026: 3 wallets without a subscription (§8.1 said 0).
export const WALLET_LIMITS = { NONE: 3, CLASSIC: 5, PREMIUM: 10 } as const satisfies Record<
  Plan | "NONE",
  number
>;
export const WALLET_NAME_MAX_CHARS = 32;
export const IMPORT_INPUT_TIMEOUT_MS = 120 * SECOND_MS;

// SOL amounts, always in lamports
export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 10n ** BigInt(SOL_DECIMALS);
/** 0.05 SOL, provisional (§10.1). */
export const FEE_MARGIN_LAMPORTS = 50_000_000n;
/** 1.050 SOL: a wallet is "ready" from 1 SOL + the fee margin (D13). */
export const WALLET_READY_MIN_LAMPORTS = LAMPORTS_PER_SOL + FEE_MARGIN_LAMPORTS;

// Dev buy (§6, §10.1)
export const DEV_BUY_MIN_SOL = 1;
export const DEV_BUY_MAX_SOL = 20;
export const DEV_BUY_PRESETS_SOL = [3, 5, 10] as const;

// Token generator (§5)
export const TOKEN_NAME_MAX_BYTES = 32;
export const TOKEN_TICKER_MAX_BYTES = 10;
/** Per UTC calendar day (D9). */
export const AI_GENERATIONS_PER_DAY = 50;

// Simulation (§7.4)
export const SIM_DURATION_SEC = 180;

// Caches (§4.3). `balances` is per user, the others are shared.
export const CACHE_TTL_MS = {
  balances: 30 * SECOND_MS,
  solPrice: 60 * SECOND_MS,
  solPriceMaxStale: 10 * MINUTE_MS,
  activeSubscribers: 60 * SECOND_MS,
  channelMembers: 10 * MINUTE_MS,
  channelMembership: 10 * MINUTE_MS,
  pumpGlobal: HOUR_MS,
} as const;
export const REFRESH_THROTTLE_MS = 10 * SECOND_MS;

// Data lifecycle (§11.3)
/** Decision of 16/09/2026: admins are exempt, no warning is sent (V1-45). */
export const INACTIVITY_DELETE_MS = 48 * HOUR_MS;
/** Proposal (V1-45). */
export const INACTIVITY_CHECK_INTERVAL_MS = 15 * MINUTE_MS;
/** Token drafts and simulations. */
export const DATA_RETENTION_MS = 90 * DAY_MS;

// Mini App requests (§12). Proposals: the Mini App calls the API when it opens (V1-24), so one
// hour is plenty, and a minute absorbs the clock drift between Telegram and the server.
/**
 * Lower case, as Node reports incoming headers. The API reads it, the Mini App sends it and
 * the logger redacts it: one name, so a rename cannot leave the redaction behind.
 */
export const INIT_DATA_HEADER = "x-telegram-init-data";
export const INIT_DATA_MAX_AGE_SEC = 3600;
export const INIT_DATA_CLOCK_SKEW_SEC = 60;

// Telegram Bot API limits
export const TG = {
  CALLBACK_DATA_MAX_BYTES: 64,
  MESSAGE_MAX_CHARS: 4096,
  CAPTION_MAX_CHARS: 1024,
  CALLBACK_ALERT_MAX_CHARS: 200,
} as const;

export type RateLimit = { limit: number; windowMs: number };

// Rate limits (D17). Every value is a proposal.
export const RATE_LIMITS = {
  /** Every update of a user (V1-04). */
  global: { limit: 20, windowMs: 10 * SECOND_MS },
  /**
   * Refresh without the balance cache (§4.4): one per user, shared by every Refresh button
   * (home, wallet detail V1-10, Dev buy V1-36). Over it, the Refresh reads the cache.
   */
  refresh: { limit: 1, windowMs: REFRESH_THROTTLE_MS },
  /** "I've joined": one getChatMember call each (V1-06). */
  channelCheck: { limit: 5, windowMs: 30 * SECOND_MS },
  /** Generate + AI Generate (V1-16, V1-17). */
  generate: { limit: 20, windowMs: 60 * SECOND_MS },
  /** Simulation creation (V1-22). */
  simulation: { limit: 10, windowMs: 10 * MINUTE_MS },
  /** V1-14. */
  withdrawal: { limit: 5, windowMs: 10 * MINUTE_MS },
  /** V1-31. */
  payFromWallet: { limit: 5, windowMs: 10 * MINUTE_MS },
  /** Invoice creation (V1-28, V1-30). */
  invoice: { limit: 5, windowMs: 10 * MINUTE_MS },
  /** "I've paid" (V1-30). */
  paymentCheck: { limit: 1, windowMs: 5 * SECOND_MS },
  /** Mini App API (V1-23). */
  api: { limit: 60, windowMs: 60 * SECOND_MS },
} as const satisfies Record<string, RateLimit>;
