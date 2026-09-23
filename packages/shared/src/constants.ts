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
/** The two formats a user can import a wallet in (§9.4). `WalletSource` of V1-02 mirrors them. */
export const IMPORT_FORMATS = ["KEY", "SEED"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
/** How long an import input stays armed (§9.4, V1-12): a late secret is deleted, not imported. */
export const IMPORT_INPUT_TIMEOUT_MS = 120 * SECOND_MS;
/** Refused before parsing (V1-12): a 24-word phrase is about 200 characters, a key 88. */
export const IMPORT_SECRET_MAX_CHARS = 1_000;

// Withdrawals (§9.5, V1-14)
/** The two shares of the balance the amount step offers, next to Max and Custom. */
export const WITHDRAWAL_PRESETS_PCT = [25, 50] as const;
export type WithdrawalPresetPct = (typeof WITHDRAWAL_PRESETS_PCT)[number];
/**
 * A withdrawal still PENDING after this is not in flight any more (proposal): its transaction
 * either landed, and the next attempt finds it, or its blockhash expired long ago.
 */
export const WITHDRAWAL_IN_FLIGHT_MS = 2 * MINUTE_MS;
/** `Withdrawal.error` (proposal): a code and a short reason, never a secret. */
export const WITHDRAWAL_ERROR_MAX_CHARS = 500;

// SOL amounts, always in lamports
export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 10n ** BigInt(SOL_DECIMALS);
/** 0.05 SOL, provisional (§10.1). */
export const FEE_MARGIN_LAMPORTS = 50_000_000n;
/** 1.050 SOL: a wallet is "ready" from 1 SOL + the fee margin (D13). */
export const WALLET_READY_MIN_LAMPORTS = LAMPORTS_PER_SOL + FEE_MARGIN_LAMPORTS;

// Fee budget of a SOL transfer (V1-11): the upper bound a screen can show before V1-13 has
// simulated the real transaction. A test of @launchbot/solana keeps it above the real estimate.
/** Base fee of one signature, the only per-signature price of Solana. */
export const BASE_FEE_LAMPORTS = 5_000n;
/** A transfer with compute budget instructions uses a few hundred units: a deliberate ceiling. */
export const TRANSFER_COMPUTE_UNIT_LIMIT = 1_000;
export const MICROLAMPORTS_PER_LAMPORT = 1_000_000;

// Sending transactions (§12, V1-13). Every amount is in lamports.
/** Ceiling of one transaction, imposed by the Compute Budget program. */
export const MAX_COMPUTE_UNITS = 1_400_000;
/** Margin over what the simulation consumed (proposal): 450 units asked as 540. */
export const CU_MARGIN = 1.2;
/** A transaction is re-signed on a fresh blockhash at most once (proposal). */
export const TX_MAX_ATTEMPTS = 2;
/** The very same bytes are broadcast again at this pace while the blockhash is valid. */
export const REBROADCAST_INTERVAL_MS = 2 * SECOND_MS;
/**
 * Safety net (proposal): a blockhash lives about a minute, so a confirmation that is still
 * pending after twice that is reported as unknown, whatever block height the RPC claims.
 */
export const TX_CONFIRM_TIMEOUT_MS = 2 * MINUTE_MS;
/**
 * Why a transaction did not go through (§10.2, V1-13). `TxFailure` of @launchbot/solana carries
 * one of them and `en.tx.errors` holds its text: one list, so neither side can drift.
 */
export const TX_FAILURE_CODES = [
  "INVALID_AMOUNT",
  "INSUFFICIENT_FUNDS",
  "REMAINING_BELOW_RENT",
  "DESTINATION_BELOW_RENT",
  "TRANSACTION_REJECTED",
  "BLOCKHASH_EXPIRED",
  "CONFIRMATION_UNKNOWN",
  "RPC_UNAVAILABLE",
] as const;
export type TxFailureCode = (typeof TX_FAILURE_CODES)[number];

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
  /** The rent-exempt minimum of an empty account does not move (proposal, V1-13). */
  rentMin: HOUR_MS,
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
  /** Wallet import attempts, valid or not (V1-12). Proposal: 5 per 10 minutes. */
  walletImport: { limit: 5, windowMs: 10 * MINUTE_MS },
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
