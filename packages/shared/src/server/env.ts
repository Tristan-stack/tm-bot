import { writeSync } from "node:fs";
import bs58 from "bs58";
import { z } from "zod";
import { SOLANA_CLUSTERS } from "../cluster.js";
import { DEFAULT_TERMS_VERSION } from "../legal.js";
import { withoutTrailingSlash } from "../url.js";
import { loadDotenvOnce } from "./dotenv.js";
import { createLogger, LOG_LEVELS } from "./logger.js";

/**
 * Every reason shown to the operator is written here. zod messages can echo the received
 * value, so a reason that is not in this list is replaced by `invalid`: no value of the
 * environment ever reaches an error message or a log.
 */
const REASON = {
  required: "is required",
  invalid: "is invalid",
  botToken: "must look like <digits>:<token>, as given by BotFather",
  databaseUrl: "must be a postgres:// or postgresql:// URL",
  cluster: `must be one of: ${SOLANA_CLUSTERS.join(", ")}`,
  httpUrl: "must be an http(s) URL",
  httpsUrl: "must be an https:// URL",
  encryptionKey: "must be valid base64 that decodes to exactly 32 bytes",
  channelId: "must be -100<digits> or @username",
  telegramUrl: "must be an https://t.me/… link",
  nonNegativeInt: "must be an integer >= 0",
  positiveInt: "must be an integer > 0",
  port: "must be a port number from 1 to 65535",
  maxBelowMin: "must be >= PRIORITY_FEE_MIN_MICROLAMPORTS",
  adminIds: "must be positive integers separated by commas",
  treasury: "must be a base58 Solana address (32 bytes)",
  logLevel: `must be one of: ${LOG_LEVELS.join(", ")}`,
} as const;

const KNOWN_REASONS = new Set<string>(Object.values(REASON));

const DIGITS = /^\d+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function hasProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function decodeEncryptionKey(value: string): Uint8Array | undefined {
  if (!BASE64.test(value) || value.length % 4 !== 0) return undefined;
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  return bytes.length === 32 ? bytes : undefined;
}

function isSolanaAddress(value: string): boolean {
  try {
    return bs58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function parseAdminIds(value: string | undefined): number[] | undefined {
  if (value === undefined) return [];
  const ids = new Set<number>();
  for (const part of value.split(",")) {
    const text = part.trim();
    const id = Number(text);
    if (!DIGITS.test(text) || !Number.isSafeInteger(id) || id <= 0) return undefined;
    ids.add(id);
  }
  return [...ids];
}

const required = () => z.string({ error: REASON.required });

const integer = (reason: string, min: number, max = Number.MAX_SAFE_INTEGER) =>
  required()
    .regex(DIGITS, reason)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value >= min && value <= max, reason);

const httpUrl = () => required().refine((v) => hasProtocol(v, ["http:", "https:"]), REASON.httpUrl);
const httpsUrl = () => required().refine((v) => hasProtocol(v, ["https:"]), REASON.httpsUrl);
const channelId = () =>
  required().regex(/^(-100\d+|@[A-Za-z][A-Za-z0-9_]{4,31})$/, REASON.channelId);
const telegramUrl = () => required().regex(/^https:\/\/t\.me\/\S+$/, REASON.telegramUrl);

// Formats that §12 of the context does not spell out are proposals of ticket V1-01.
const envSchema = z.object({
  BOT_TOKEN: required().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, REASON.botToken),
  DATABASE_URL: required().refine(
    (v) => hasProtocol(v, ["postgres:", "postgresql:"]),
    REASON.databaseUrl,
  ),
  // Anything other than devnet is refused by the startup guard of V1-04, not here.
  SOLANA_CLUSTER: z.enum(SOLANA_CLUSTERS, { error: REASON.cluster }).default("devnet"),
  SOLANA_RPC_URL: httpUrl().default("https://api.devnet.solana.com"),
  WALLET_ENCRYPTION_KEY: required().transform((value, ctx) => {
    const key = decodeEncryptionKey(value);
    if (key === undefined) {
      ctx.addIssue({ code: "custom", message: REASON.encryptionKey });
      return z.NEVER;
    }
    return key;
  }),
  // Telegram refuses web_app buttons that are not https.
  WEBAPP_URL: httpsUrl().transform(withoutTrailingSlash),
  API_URL: httpUrl().transform(withoutTrailingSlash),
  CHANNEL_BOT_ID: channelId(),
  CHANNEL_BOT_URL: telegramUrl(),
  CHANNEL_SUCCESS_ID: channelId(),
  CHANNEL_SUCCESS_URL: telegramUrl(),
  CHANNEL_ANNOUNCEMENTS_ID: channelId(),
  CHANNEL_ANNOUNCEMENTS_URL: telegramUrl(),
  SUPPORT_URL: telegramUrl(),
  DEFAULT_TOKEN_IMAGE_URL: httpsUrl().optional(),
  PRIORITY_FEE_MIN_MICROLAMPORTS: integer(REASON.nonNegativeInt, 0).default(0),
  PRIORITY_FEE_MAX_MICROLAMPORTS: integer(REASON.positiveInt, 1),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      const ids = parseAdminIds(value);
      if (ids === undefined) {
        ctx.addIssue({ code: "custom", message: REASON.adminIds });
        return z.NEVER;
      }
      return ids;
    }),
  TREASURY_WALLET: required().refine(isSolanaAddress, REASON.treasury),
  TERMS_VERSION: integer(REASON.positiveInt, 1).default(DEFAULT_TERMS_VERSION),
  // Optional: CoinGecko Simple Price by default (D11). Another URL must answer the same shape.
  SOL_PRICE_API_URL: httpUrl().optional(),
  // A key alone does not enable AI Generate: a provider must also be implemented (DEC-02).
  LLM_API_KEY: z.string().optional(),
  IMAGE_API_KEY: z.string().optional(),

  // Outside §12 (proposals).
  // The /api proxy of apps/webapp/vite.config.ts assumes the same default.
  API_PORT: integer(REASON.port, 1, 65_535).default(3001),
  // 0.0.0.0 in a container; the loopback by default, so a dev machine exposes nothing.
  API_HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: REASON.logLevel }).default("info"),
});

export type Env = z.infer<typeof envSchema>;
export type EnvIssue = { variable: string; reason: string };

export class EnvValidationError extends Error {
  readonly issues: EnvIssue[];

  constructor(issues: EnvIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.reason}`);
    super(`Invalid environment configuration:\n${lines.join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/** Keeps the known variables only; a blank value counts as an absent variable. */
function pickVariables(source: Record<string, string | undefined>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of Object.keys(envSchema.shape)) {
    const value = source[name]?.trim();
    if (value !== undefined && value !== "") picked[name] = value;
  }
  return picked;
}

/** Checked apart from the schema so it is reported even when other variables are faulty. */
function feeBoundsIssue(variables: Record<string, string>): EnvIssue | undefined {
  const min = envSchema.shape.PRIORITY_FEE_MIN_MICROLAMPORTS.safeParse(
    variables["PRIORITY_FEE_MIN_MICROLAMPORTS"],
  );
  const max = envSchema.shape.PRIORITY_FEE_MAX_MICROLAMPORTS.safeParse(
    variables["PRIORITY_FEE_MAX_MICROLAMPORTS"],
  );
  if (!min.success || !max.success || max.data >= min.data) return undefined;
  return { variable: "PRIORITY_FEE_MAX_MICROLAMPORTS", reason: REASON.maxBelowMin };
}

/** Pure: validates a set of variables. Throws EnvValidationError listing every faulty variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const variables = pickVariables(source);
  const result = envSchema.safeParse(variables);

  const issues: EnvIssue[] = [];
  for (const issue of result.error?.issues ?? []) {
    const variable = String(issue.path[0] ?? "environment");
    const reason = KNOWN_REASONS.has(issue.message) ? issue.message : REASON.invalid;
    if (!issues.some((known) => known.variable === variable)) issues.push({ variable, reason });
  }
  const feeBounds = feeBoundsIssue(variables);
  if (feeBounds !== undefined) issues.push(feeBounds);

  if (!result.success || issues.length > 0) throw new EnvValidationError(issues);
  return result.data;
}

let cached: Env | undefined;

/**
 * Loads the root `.env`, validates process.env and memoizes the result.
 * On an invalid configuration, prints the faulty variables (never their values) and exits
 * with code 1: no process starts with a broken configuration.
 */
export function loadEnv(): Env {
  if (cached !== undefined) return cached;
  loadDotenvOnce();
  try {
    cached = parseEnv(process.env);
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    // Synchronous write: the message must be out before the process exits, even on a pipe.
    writeSync(process.stderr.fd, `${error.message}\n`);
    process.exit(1);
  }
  if (cached.ADMIN_TELEGRAM_IDS.length === 0) {
    createLogger("env").warn("ADMIN_TELEGRAM_IDS is empty: admin commands are disabled");
  }
  return cached;
}
