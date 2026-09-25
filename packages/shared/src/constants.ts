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
/** `Payment.solUsdRate` is a `Decimal(18, 8)`: the rate of an invoice is kept to 8 decimals. */
export const SOL_USD_RATE_DECIMALS = 8;
export const LATE_PAYMENT_TOLERANCE_MS = 24 * HOUR_MS;
export const PAYMENT_CHECK_INTERVAL_MS = 15 * SECOND_MS;
export const DEPOSIT_WATCH_MS = 30 * DAY_MS;
export const REMINDER_BEFORE_MS = {
  ONE_MONTH: 24 * HOUR_MS,
  TWO_DAYS: 6 * HOUR_MS,
} as const satisfies Record<Duration, number>;
/** Under this remaining time the home screen shows `1d 4h left` instead of `until 12 Oct`. */
export const REMAINING_DETAIL_BELOW_MS = 72 * HOUR_MS;

// The worker (§12, V1-32 to V1-34). Cron expressions are in UTC (D18); every value is a proposal.
/** A worker without the lock of the payment loop tries to take it again at this pace. */
export const WORKER_LOCK_RETRY_MS = 30 * SECOND_MS;
/** What the jobs of a stopping worker get to finish (`boss.stop`). */
export const WORKER_STOP_TIMEOUT_MS = 30 * SECOND_MS;
export const EVERY_MINUTE_CRON = "* * * * *";
/** « Payment received »: attempts after a network error or a 5xx of Telegram. */
export const NOTIFY_RETRY_LIMIT = 5;
/** A deposit that holds less than this once the fees are paid is left where it is (V1-33). */
export const SWEEP_DUST_LAMPORTS = 10_000n;
/** Attempts of a transfer to the treasury, `SWEEP_RETRY_DELAY_SEC` doubled each time. */
export const SWEEP_RETRY_LIMIT = 8;
export const SWEEP_RETRY_DELAY_SEC = 30;
/** An address is not emptied until this long after its 24 h: the payment loop may be on it. */
export const WATCH_RACE_MARGIN_MS = 2 * MINUTE_MS;
export const DEPOSIT_WATCH_CRON = "*/5 * * * *";
export const DEPOSIT_KEY_PURGE_CRON = "15 3 * * *";
/** Reminders sent per run of the job, the closest ends first (V1-34). */
export const REMINDER_BATCH_SIZE = 100;

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
/**
 * 0.05 SOL, provisional (§10.1): the fees the recap of a launch estimates. Not asked of the
 * wallet on top of the dev buy and the bundle (decision of 25/09/2026).
 */
export const FEE_MARGIN_LAMPORTS = 50_000_000n;

// Fee budget of a SOL transfer (V1-11): the upper bound a screen can show before V1-13 has
// simulated the real transaction. A test of @launchbot/solana keeps it above the real estimate.
/** Base fee of one signature, the only per-signature price of Solana. */
export const BASE_FEE_LAMPORTS = 5_000n;
/** A transfer with compute budget instructions uses a few hundred units: a deliberate ceiling. */
export const TRANSFER_COMPUTE_UNIT_LIMIT = 1_000;
export const MICROLAMPORTS_PER_LAMPORT = 1_000_000;
/** Limit of `getMultipleAccountsInfo`: the grouped balance reads (V1-07, V1-28) go by this. */
export const MAX_ACCOUNTS_PER_READ = 100;

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

// Dev buy and bundle (§6, §10.1, decision of 25/09/2026): the dev buys 1 SOL at the launch,
// then the bundle buys in the next block, from the same wallet. The user picks the bundle, in
// a simulation as in a launch.
/** The dev buy of every launch and every simulation: fixed. */
export const DEV_BUY_SOL = 1;
export const DEV_BUY_LAMPORTS = BigInt(DEV_BUY_SOL) * LAMPORTS_PER_SOL;
export const BUNDLE_MIN_SOL = 3;
export const BUNDLE_MAX_SOL = 20;
export const BUNDLE_PRESETS_SOL = [3, 5, 10] as const;
/** A Custom bundle is typed with 3 decimals at most (proposal, V1-22). */
export const BUNDLE_MAX_DECIMALS = 3;
export const BUNDLE_MIN_LAMPORTS = BigInt(BUNDLE_MIN_SOL) * LAMPORTS_PER_SOL;
export const BUNDLE_MAX_LAMPORTS = BigInt(BUNDLE_MAX_SOL) * LAMPORTS_PER_SOL;
/** 0.001 SOL: every bundle is a whole number of it. */
export const BUNDLE_LAMPORT_UNIT = 10n ** BigInt(SOL_DECIMALS - BUNDLE_MAX_DECIMALS);
/** 4 SOL: a wallet is "ready" from the dev buy + the smallest bundle, no fee margin (D13). */
export const WALLET_READY_MIN_LAMPORTS = DEV_BUY_LAMPORTS + BUNDLE_MIN_LAMPORTS;
/** 21 SOL: the most the dev buys at t = 0, the dev buy and the largest bundle. */
export const MAX_OPENING_BUY_SOL = DEV_BUY_SOL + BUNDLE_MAX_SOL;
/**
 * Launch Coin creates nothing in V1 (§10.1, D6): the recap says so and Create token only
 * answers an alert. V2-04 turns it on, which also drops the notice of the recap.
 */
export const TOKEN_CREATION_ENABLED = false;

// Token generator (§5). The byte limits come from Metaplex: kept in the interface, to be checked
// against `create_v2` in V2-01. The zod schemas of `token/fields.ts` read them here, nowhere else.
export const TOKEN_NAME_MAX_BYTES = 32;
export const TOKEN_TICKER_MAX_BYTES = 10;
/** 1 to 3 short sentences (§5). */
export const TOKEN_DESCRIPTION_MAX_SENTENCES = 3;
/** Code points, not bytes (proposal, V1-15). */
export const TOKEN_DESCRIPTION_MAX_CHARS = 280;
/** Website, X and Telegram links, in characters (proposal, V1-15). */
export const TOKEN_URL_MAX_LENGTH = 200;
/** A link shown on a screen is cut at this many characters with an ellipsis (proposal, V1-15). */
export const TOKEN_LINK_DISPLAY_MAX_CHARS = 40;
/** Letters of a generated ticker, A to Z (proposal, V1-15): `OTTR`, `MOTTER`. */
export const GENERATED_TICKER_LETTERS = { min: 3, max: 6 } as const;
/** An input of the Token screen (V1-16) still open after this is ignored (proposal). */
export const TOKEN_INPUT_TIMEOUT_MS = 10 * MINUTE_MS;
/** The image of a token (§5): what `getFile` can download later (V1-23, V2-02). Proposals. */
export const TOKEN_IMAGE_MAX_MB = 20;
export const TOKEN_IMAGE_MAX_BYTES = TOKEN_IMAGE_MAX_MB * 1024 * 1024;
export const TOKEN_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Per UTC calendar day (D9). */
export const AI_GENERATIONS_PER_DAY = 50;
/** A provider slower than this is dropped for the local generator (proposals, V1-17). */
export const AI_TEXT_TIMEOUT_MS = 15 * SECOND_MS;
export const AI_LOGO_TIMEOUT_MS = 30 * SECOND_MS;

// Simulation (§7.4)
export const SIM_DURATION_SEC = 180;
/** The recap shows the same Simulation again while it is younger than this (proposal, V1-22). */
export const SIMULATION_REUSE_MS = HOUR_MS;

// The simulated clock of the simulation in the chat (§6.1, §7.4, V1-26).
/** `x1`, `x2`, `x5` (§6.1): simulated seconds per real second. */
export const SIM_SPEEDS = [1, 2, 5] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];
/** A seed fits the uint32 of the engine and the signed Int of Prisma (V1-22): 0 to 2^31 − 1. */
export const SIM_SEED_MAX = 2 ** 31 - 1;
/** The speed a simulation starts at (proposal): 3 simulated minutes in 90 real seconds. */
export const SIM_DEFAULT_SPEED: SimSpeed = 2;
/** One picture every 3 s (proposal): Telegram tolerates about one edit per second per chat. */
export const SIM_FRAME_MS = 3 * SECOND_MS;
/** Two edits of the same message never closer than this (a sale right after a tick). */
export const SIM_MIN_EDIT_GAP_MS = SECOND_MS;
/** Simulations running at once in the process (proposal): a render and an upload each per frame. */
export const SIM_MAX_ACTIVE = 20;
/** A paused simulation nobody touches ends after this (proposal). */
export const SIM_PAUSE_TIMEOUT_MS = 10 * MINUTE_MS;
/** At the end, the last picture (the closing sale drawn) stays this long before the card (proposal). */
export const SIM_END_HOLD_MS = 2 * SECOND_MS;

// Caches (§4.3). `balances` is per user, the others are shared.
export const CACHE_TTL_MS = {
  balances: 30 * SECOND_MS,
  solPrice: 60 * SECOND_MS,
  solPriceMaxStale: 10 * MINUTE_MS,
  activeSubscribers: 60 * SECOND_MS,
  channelMembers: 10 * MINUTE_MS,
  channelMembership: 10 * MINUTE_MS,
  pumpGlobal: HOUR_MS,
  /** A failed read of the pump.fun Global account is retried after this (proposal, V1-21). */
  pumpGlobalFailure: 5 * MINUTE_MS,
  /** The rent-exempt minimum of an empty account does not move (proposal, V1-13). */
  rentMin: HOUR_MS,
} as const;
export const REFRESH_THROTTLE_MS = 10 * SECOND_MS;

// Data lifecycle (§11.3)
/**
 * 24 h without activity (Tristan, 25/09/2026; 48 h in the decision of 16/09/2026): the SOL goes
 * to the treasury, then the account is deleted. Admins are exempt, no warning is sent (V1-45).
 */
export const INACTIVITY_DELETE_MS = 24 * HOUR_MS;
/** Proposal (V1-45): whole minutes that divide an hour, the job runs on a cron. */
export const INACTIVITY_CHECK_INTERVAL_MS = 15 * MINUTE_MS;
/** Token drafts and simulations. */
export const DATA_RETENTION_MS = 90 * DAY_MS;
/** Accounts read per page by the inactive-accounts job, by cursor (V1-45). */
export const INACTIVE_ACCOUNTS_PAGE_SIZE = 100;
/** Rows deleted per statement by the 90-day cleanup (V1-45). */
export const CLEANUP_BATCH_SIZE = 1_000;
/** The 90-day cleanup (proposal): after the purge of the deposit keys at 03:15 (V1-33). */
export const DATA_CLEANUP_CRON = "30 3 * * *";

// Support (§11.1, V1-40)
/**
 * The Contact support button pre-fills the first message with the support code (`?text=` of a
 * t.me link, `?start=` for a bot). Documented by Telegram, to check on each client (manual test
 * of V1-40): the code is on the screen whatever a client does with it.
 */
export const SUPPORT_PREFILL_ENABLED = true;

// Admin commands (§11.4, V1-38 to V1-44). The two delays of /getall are the decision of
// 16/09/2026; every other value is a proposal.
/** A /grant confirmation older than this is refused: the admin sends /grant again. */
export const ADMIN_CONFIRM_TTL_MS = 10 * MINUTE_MS;
/** /grant tells the user the plan is active (proposal of V1-42). */
export const GRANT_NOTIFY_USER = true;
/** Reveal keys of a /getall stays armed this long. */
export const GETALL_REVEAL_TTL_MS = 5 * MINUTE_MS;
/** A message holding wallet keys is deleted this long after its send. */
export const SENSITIVE_MESSAGE_TTL_MS = 60 * SECOND_MS;
/** The sweeper of those messages: its pace, and the rows due it deletes per pass. */
export const SENSITIVE_SWEEP_INTERVAL_MS = 5 * SECOND_MS;
export const SENSITIVE_SWEEP_BATCH_SIZE = 50;
/**
 * `protect_content` on the keys: off, since some clients then refuse to copy the text too (a tap
 * on <code> included). The deletion after 60 s is the protection (decision of 16/09/2026).
 */
export const GETALL_PROTECT_CONTENT = false;
/** What /whois and /getall list, latest first (§11.4). */
export const WHOIS_PAYMENTS = 5;
export const GETALL_PURCHASES = 20;
export const GETALL_SUBSCRIPTIONS = 5;
export const GETALL_WITHDRAWALS = 10;
/** The error of a failed withdrawal, cut on /getall. */
export const GETALL_ERROR_MAX_CHARS = 80;

// Mini App requests (§12, V1-05). Proposals: a page calls the API when it opens, so one hour
// is plenty, and a minute absorbs the clock drift between Telegram and the server.
/**
 * Lower case, as Node reports incoming headers. The API reads it, the Mini App sends it and
 * the logger redacts it: one name, so a rename cannot leave the redaction behind.
 */
export const INIT_DATA_HEADER = "x-telegram-init-data";
/** The image of a token read from Telegram (proposal): Telegram itself caps a bot at 20 MB. */
export const API_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Token images kept in memory for the simulation picture (proposal): 10 × 5 MB, an hour each. */
export const API_IMAGE_CACHE_MAX_ENTRIES = 10;
export const API_IMAGE_CACHE_TTL_MS = HOUR_MS;
/** `getFile` and the download of a Telegram file (proposal). */
export const TELEGRAM_FILE_TIMEOUT_MS = 10 * SECOND_MS;
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
} as const satisfies Record<string, RateLimit>;
