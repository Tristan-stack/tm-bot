export const CENSOR = "[REDACTED]";

/** Exact values shorter than this are not searched for: too many false positives. */
const MIN_SECRET_LENGTH = 8;

/** Variables whose exact value must never reach a log line. */
export const SECRET_ENV_VARIABLES = [
  "BOT_TOKEN",
  "WALLET_ENCRYPTION_KEY",
  "DATABASE_URL",
  "LLM_API_KEY",
  "IMAGE_API_KEY",
] as const;

const PUBLIC_RPC_URL = /^https:\/\/api\.(devnet|testnet|mainnet-beta)\.solana\.com\/?$/;

// Telegram bot token, alone or inside https://api.telegram.org/bot<token>/method.
const BOT_TOKEN_PATTERN = /\d{6,}:[A-Za-z0-9_-]{30,}/g;
// user:password@ part of any URL (DATABASE_URL, authenticated RPC).
const URL_CREDENTIALS_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/"'<>@\\]+@/gi;
// Query string of http(s) URLs: paid RPC providers put their key there (?api-key=…).
// Quotes and backslashes are excluded so a scrubbed JSON log line stays valid JSON.
const URL_QUERY_PATTERN = /(https?:\/\/[^\s"'<>?#\\]+)\?[^\s"'<>#\\]*/gi;

export type SecretScrubber = (text: string) => string;

const extraScrubbers: SecretScrubber[] = [];

/** Lets later tickets plug their own heuristics (private keys and seed phrases, V1-12). */
export function addSecretScrubber(scrubber: SecretScrubber): void {
  extraScrubbers.push(scrubber);
}

function exactSecrets(): string[] {
  const secrets: string[] = [];
  for (const name of SECRET_ENV_VARIABLES) {
    const value = process.env[name];
    if (value !== undefined && value.length >= MIN_SECRET_LENGTH) secrets.push(value);
  }
  // A private RPC URL can carry its API key in the path: treated as a secret as a whole.
  const rpcUrl = process.env["SOLANA_RPC_URL"];
  if (rpcUrl !== undefined && !PUBLIC_RPC_URL.test(rpcUrl)) secrets.push(rpcUrl);
  return secrets;
}

/**
 * Removes secrets from a free text: log message, serialized error, stack trace.
 * Values are read from process.env at call time, so it works before and after loadEnv().
 */
export function scrubSecrets(text: string): string {
  let result = text;
  for (const secret of exactSecrets()) result = result.replaceAll(secret, CENSOR);
  result = result.replace(BOT_TOKEN_PATTERN, CENSOR);
  // Most log lines hold no URL: skips two regex passes, the first one costly on long blobs.
  if (result.includes("://")) {
    result = result
      .replace(URL_CREDENTIALS_PATTERN, `$1${CENSOR}@`)
      .replace(URL_QUERY_PATTERN, `$1?${CENSOR}`);
  }
  for (const scrubber of extraScrubbers) result = scrubber(result);
  return result;
}

/**
 * What a log keeps of an error: its name and its scrubbed message. Never the stack, and never
 * its own fields. The logger applies it to every `{ err }` it is given.
 */
export function scrubError(cause: unknown): { name: string; message: string } {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return { name: error.name, message: scrubSecrets(error.message) };
}
