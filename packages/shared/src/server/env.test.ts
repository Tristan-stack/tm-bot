import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./env.js";

const KEY_32_BYTES = Buffer.alloc(32, 7).toString("base64");

const valid: Record<string, string> = {
  // Built at runtime: a literal in the Telegram token format trips secret scanners.
  BOT_TOKEN: `123456789:${"AbC-dEf_9".repeat(4)}`,
  DATABASE_URL: "postgresql://launchbot:s3cr3t-pass@localhost:5432/launchbot",
  SOLANA_CLUSTER: "devnet",
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  WALLET_ENCRYPTION_KEY: KEY_32_BYTES,
  WEBAPP_URL: "https://example.trycloudflare.com/",
  API_URL: "http://localhost:3000",
  CHANNEL_BOT_ID: "-1001234567890",
  CHANNEL_BOT_URL: "https://t.me/launchbot_channel",
  CHANNEL_SUCCESS_ID: "@launchbot_success",
  CHANNEL_SUCCESS_URL: "https://t.me/launchbot_success",
  CHANNEL_ANNOUNCEMENTS_ID: "-1009876543210",
  CHANNEL_ANNOUNCEMENTS_URL: "https://t.me/launchbot_news",
  SUPPORT_URL: "https://t.me/launchbot_support",
  PRIORITY_FEE_MIN_MICROLAMPORTS: "0",
  PRIORITY_FEE_MAX_MICROLAMPORTS: "100000",
  ADMIN_TELEGRAM_IDS: "111, 222",
  TREASURY_WALLET: "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
};

const REQUIRED_VARIABLES = [
  "BOT_TOKEN",
  "DATABASE_URL",
  "WALLET_ENCRYPTION_KEY",
  "WEBAPP_URL",
  "API_URL",
  "CHANNEL_BOT_ID",
  "CHANNEL_BOT_URL",
  "CHANNEL_SUCCESS_ID",
  "CHANNEL_SUCCESS_URL",
  "CHANNEL_ANNOUNCEMENTS_ID",
  "CHANNEL_ANNOUNCEMENTS_URL",
  "SUPPORT_URL",
  "PRIORITY_FEE_MAX_MICROLAMPORTS",
  "TREASURY_WALLET",
];

function failure(source: Record<string, string | undefined>): EnvValidationError {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvValidationError) return error;
    throw error;
  }
  throw new Error("parseEnv was expected to fail");
}

const variablesOf = (error: EnvValidationError) => error.issues.map((issue) => issue.variable);

describe("parseEnv", () => {
  it("accepts a complete valid configuration and types it", () => {
    const env = parseEnv(valid);

    expect(env.SOLANA_CLUSTER).toBe("devnet");
    expect(env.WALLET_ENCRYPTION_KEY).toBeInstanceOf(Uint8Array);
    expect(env.WALLET_ENCRYPTION_KEY).toHaveLength(32);
    expect(env.ADMIN_TELEGRAM_IDS).toEqual([111, 222]);
    expect(env.PRIORITY_FEE_MAX_MICROLAMPORTS).toBe(100000);
    expect(env.WEBAPP_URL).toBe("https://example.trycloudflare.com");
    expect(env.LLM_API_KEY).toBeUndefined();
    expect(env.SOL_PRICE_API_URL).toBeUndefined();
  });

  it("applies the defaults of the context", () => {
    const source = { ...valid };
    delete source["SOLANA_CLUSTER"];
    delete source["SOLANA_RPC_URL"];
    delete source["PRIORITY_FEE_MIN_MICROLAMPORTS"];
    delete source["ADMIN_TELEGRAM_IDS"];

    const env = parseEnv(source);

    expect(env.SOLANA_CLUSTER).toBe("devnet");
    expect(env.SOLANA_RPC_URL).toBe("https://api.devnet.solana.com");
    expect(env.PRIORITY_FEE_MIN_MICROLAMPORTS).toBe(0);
    expect(env.ADMIN_TELEGRAM_IDS).toEqual([]);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("ignores a variable it does not read, such as TERMS_VERSION in an older .env", () => {
    const env = parseEnv({ ...valid, TERMS_VERSION: "1" });

    expect(env).not.toHaveProperty("TERMS_VERSION");
  });

  it.each(REQUIRED_VARIABLES)("reports %s when it is missing", (variable) => {
    const error = failure({ ...valid, [variable]: undefined });

    expect(error.issues).toEqual([{ variable, reason: "is required" }]);
  });

  it("treats an empty or blank string as an absent variable", () => {
    expect(variablesOf(failure({ ...valid, BOT_TOKEN: "" }))).toEqual(["BOT_TOKEN"]);
    expect(variablesOf(failure({ ...valid, TREASURY_WALLET: "   " }))).toEqual(["TREASURY_WALLET"]);
    expect(parseEnv({ ...valid, LLM_API_KEY: "", SOLANA_CLUSTER: "" }).LLM_API_KEY).toBeUndefined();
  });

  it("lists every faulty variable at once", () => {
    const error = failure({
      ...valid,
      BOT_TOKEN: undefined,
      WEBAPP_URL: "http://insecure.example.com",
      SOLANA_CLUSTER: "localnet",
      PRIORITY_FEE_MIN_MICROLAMPORTS: "500",
      PRIORITY_FEE_MAX_MICROLAMPORTS: "100",
    });

    expect(variablesOf(error).sort()).toEqual([
      "BOT_TOKEN",
      "PRIORITY_FEE_MAX_MICROLAMPORTS",
      "SOLANA_CLUSTER",
      "WEBAPP_URL",
    ]);
    expect(error.message).toContain("WEBAPP_URL: must be an https:// URL");
  });

  it.each([
    ["31 bytes", Buffer.alloc(31, 1).toString("base64")],
    ["33 bytes", Buffer.alloc(33, 1).toString("base64")],
    ["invalid base64", `${"!".repeat(43)}=`],
    ["base64 without padding", KEY_32_BYTES.replace("=", "")],
  ])("rejects a WALLET_ENCRYPTION_KEY of %s", (_label, key) => {
    expect(variablesOf(failure({ ...valid, WALLET_ENCRYPTION_KEY: key }))).toEqual([
      "WALLET_ENCRYPTION_KEY",
    ]);
  });

  it("parses ADMIN_TELEGRAM_IDS into a deduplicated list of numbers", () => {
    expect(parseEnv({ ...valid, ADMIN_TELEGRAM_IDS: "1, 2,2" }).ADMIN_TELEGRAM_IDS).toEqual([1, 2]);
    expect(variablesOf(failure({ ...valid, ADMIN_TELEGRAM_IDS: "abc" }))).toEqual([
      "ADMIN_TELEGRAM_IDS",
    ]);
    expect(variablesOf(failure({ ...valid, ADMIN_TELEGRAM_IDS: "1,,2" }))).toEqual([
      "ADMIN_TELEGRAM_IDS",
    ]);
    expect(variablesOf(failure({ ...valid, ADMIN_TELEGRAM_IDS: "-5" }))).toEqual([
      "ADMIN_TELEGRAM_IDS",
    ]);
  });

  it("validates SOLANA_CLUSTER without refusing other clusters (devnet guard is V1-04)", () => {
    expect(parseEnv({ ...valid, SOLANA_CLUSTER: "mainnet-beta" }).SOLANA_CLUSTER).toBe(
      "mainnet-beta",
    );
    expect(variablesOf(failure({ ...valid, SOLANA_CLUSTER: "mainnet" }))).toEqual([
      "SOLANA_CLUSTER",
    ]);
  });

  it("rejects a max priority fee below the min, or equal to zero", () => {
    const below = failure({
      ...valid,
      PRIORITY_FEE_MIN_MICROLAMPORTS: "1000",
      PRIORITY_FEE_MAX_MICROLAMPORTS: "999",
    });
    expect(below.issues).toEqual([
      {
        variable: "PRIORITY_FEE_MAX_MICROLAMPORTS",
        reason: "must be >= PRIORITY_FEE_MIN_MICROLAMPORTS",
      },
    ]);
    expect(variablesOf(failure({ ...valid, PRIORITY_FEE_MAX_MICROLAMPORTS: "0" }))).toEqual([
      "PRIORITY_FEE_MAX_MICROLAMPORTS",
    ]);
    expect(variablesOf(failure({ ...valid, PRIORITY_FEE_MIN_MICROLAMPORTS: "-1" }))).toEqual([
      "PRIORITY_FEE_MIN_MICROLAMPORTS",
    ]);
  });

  it("rejects malformed channels, links, treasury and database URL", () => {
    const error = failure({
      ...valid,
      CHANNEL_BOT_ID: "1234",
      CHANNEL_BOT_URL: "https://example.com/channel",
      TREASURY_WALLET: "not-a-solana-address",
      DATABASE_URL: "mysql://root@localhost/db",
      DEFAULT_TOKEN_IMAGE_URL: "http://example.com/logo.png",
    });

    expect(variablesOf(error).sort()).toEqual([
      "CHANNEL_BOT_ID",
      "CHANNEL_BOT_URL",
      "DATABASE_URL",
      "DEFAULT_TOKEN_IMAGE_URL",
      "TREASURY_WALLET",
    ]);
  });

  it("defaults the API to the loopback on port 3001, and validates the port", () => {
    expect(parseEnv(valid)).toMatchObject({ API_PORT: 3001, API_HOST: "127.0.0.1" });
    expect(parseEnv({ ...valid, API_PORT: "8080", API_HOST: "0.0.0.0" })).toMatchObject({
      API_PORT: 8080,
      API_HOST: "0.0.0.0",
    });
    for (const port of ["0", "65536", "-1", "http"]) {
      expect(variablesOf(failure({ ...valid, API_PORT: port }))).toEqual(["API_PORT"]);
    }
  });

  it("never puts a received value in the error", () => {
    const secrets = {
      BOT_TOKEN: "not-a-token-but-still-secret-value",
      DATABASE_URL: "mysql://root:hunter2-password@localhost/db",
      WALLET_ENCRYPTION_KEY: Buffer.alloc(31, 9).toString("base64"),
      SOLANA_RPC_URL: "ftp://rpc.example.com/?api-key=rpc-secret-key",
      TREASURY_WALLET: "treasury-value-that-is-wrong",
      ADMIN_TELEGRAM_IDS: "admin-ids-value",
      SOLANA_CLUSTER: "cluster-value",
      LOG_LEVEL: "loglevel-value",
    };
    const error = failure({ ...valid, ...secrets });
    const text = `${error.message}\n${JSON.stringify(error.issues)}\n${String(error.stack)}`;

    expect(error.issues).toHaveLength(Object.keys(secrets).length);
    for (const value of Object.values(secrets)) expect(text).not.toContain(value);
  });
});
