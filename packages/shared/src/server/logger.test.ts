import { afterEach, describe, expect, it, vi } from "vitest";
import { createRootLogger } from "./logger.js";
import { scrubSecrets } from "./scrub.js";

// Built at runtime: a literal in the Telegram token format trips secret scanners.
const BOT_TOKEN = `123456789:${"AbC-dEf_9".repeat(4)}`;
const ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
const PRIVATE_KEY = "5JdeC9P7Pbd1uGdFVEsJ41EkEnADbbHGq6p1BwFxm6txNBsQnsw";
const SEED_PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const INIT_DATA = "query_id=AAF9&user=%7B%22id%22%3A42%7D&hash=c0ffee";

function capture() {
  const lines: string[] = [];
  const logger = createRootLogger({
    level: "trace",
    destination: { write: (line) => void lines.push(line) },
  }).child({ module: "test" });
  return { logger, output: () => lines.join("") };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createRootLogger", () => {
  it("tags lines with the module name and writes valid JSON", () => {
    const { logger, output } = capture();

    logger.info({ userId: 42 }, "hello");

    expect(JSON.parse(output())).toMatchObject({ module: "test", userId: 42, msg: "hello" });
  });

  it("redacts secret keys of logged objects, up to two levels deep", () => {
    const { logger, output } = capture();

    logger.info(
      {
        secretKey: PRIVATE_KEY,
        wallet: { privateKey: PRIVATE_KEY, seedPhrase: SEED_PHRASE, mnemonic: SEED_PHRASE },
        ctx: { session: { initData: INIT_DATA, token: BOT_TOKEN } },
        req: { headers: { "x-telegram-init-data": INIT_DATA, authorization: "Bearer abc.def" } },
      },
      "wallet imported",
    );

    const text = output();
    expect(text).toContain("[REDACTED]");
    for (const secret of [PRIVATE_KEY, SEED_PHRASE, INIT_DATA, BOT_TOKEN, "Bearer abc.def"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("scrubs the bot token from error messages and stack traces", () => {
    const { logger, output } = capture();
    const error = new Error(`request to https://api.telegram.org/bot${BOT_TOKEN}/getMe failed`);

    logger.error({ err: error }, `grammY error: ${error.message}`);

    const text = output();
    expect(text).not.toContain(BOT_TOKEN);
    expect(text).toContain("https://api.telegram.org/bot[REDACTED]/getMe");
    expect(() => JSON.parse(text) as unknown).not.toThrow();
  });

  it("scrubs the exact values of BOT_TOKEN and WALLET_ENCRYPTION_KEY wherever they appear", () => {
    vi.stubEnv("BOT_TOKEN", BOT_TOKEN);
    vi.stubEnv("WALLET_ENCRYPTION_KEY", ENCRYPTION_KEY);
    const { logger, output } = capture();

    logger.warn({ detail: `key=${ENCRYPTION_KEY}` }, `decrypt failed with ${ENCRYPTION_KEY}`);
    logger.error(new Error(`bad key ${ENCRYPTION_KEY}`));

    expect(output()).not.toContain(ENCRYPTION_KEY);
    expect(output()).not.toContain(BOT_TOKEN);
  });
});

describe("scrubSecrets", () => {
  it("removes RPC API keys, URL credentials and private RPC URLs", () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://devnet.rpc-provider.example/v2/path-api-key-123456");

    expect(scrubSecrets("POST https://rpc.example.com/?api-key=abcdef123456 -> 429")).toBe(
      "POST https://rpc.example.com/?[REDACTED] -> 429",
    );
    expect(scrubSecrets("connect postgresql://launchbot:hunter2@db:5432/launchbot")).toBe(
      "connect postgresql://[REDACTED]@db:5432/launchbot",
    );
    expect(
      scrubSecrets("fetch https://devnet.rpc-provider.example/v2/path-api-key-123456 failed"),
    ).toBe("fetch [REDACTED] failed");
  });

  it("keeps harmless text and the public RPC URL untouched", () => {
    vi.stubEnv("SOLANA_RPC_URL", "https://api.devnet.solana.com");
    const text =
      "balance of 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU via https://api.devnet.solana.com";

    expect(scrubSecrets(text)).toBe(text);
  });
});
