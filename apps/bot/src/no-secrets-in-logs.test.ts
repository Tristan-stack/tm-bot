import type { SupportDataService, UserSupportData, WalletSecretsData } from "@launchbot/db";
import { captureLogs, resetRateLimits, setLogDestination } from "@launchbot/shared/server";
import { createKeyVault, generateMnemonicWallet, parsePrivateKey } from "@launchbot/solana";
import { GrammyError } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_CB } from "./features/admin/common.js";
import { PAY_CB } from "./features/subscribe/pay-screens.js";
import { SUB_CB } from "./features/subscribe/screens.js";
import { WALLET_CB } from "./features/wallets/screens.js";
import { WITHDRAW_CB } from "./features/wallets/withdraw-screens.js";
import {
  ADMIN_ID,
  botHarness,
  callbackUpdate,
  confirmData,
  feed,
  MAIN_WALLET,
  messageUpdate,
  TEST_ENV,
  TEST_INVOICE_ID,
  TEST_USER,
  TEST_WALLET,
  textUpdate,
} from "./test-harness.js";

// §14, V1-46: after the flows that handle a secret, nothing the process writes holds one. The
// logger runs at debug, and grammY's own debug output (stderr, outside the logger) is on.
vi.hoisted(() => {
  process.env["LOG_LEVEL"] = "debug";
  process.env["DEBUG"] = "grammy*";
});

/** The master key of this bot: recognisable, so a leak of any of its forms shows. */
const MASTER_KEY = new Uint8Array(32).fill(0x5a);
const TARGET_ID = 555_000_111n;

beforeEach(resetRateLimits);
afterEach(() => {
  setLogDestination(undefined);
  vi.restoreAllMocks();
});

/** A created wallet of the target, encrypted with the master key of the bot. */
function targetWallet() {
  const vault = createKeyVault(MASTER_KEY);
  const wallet = generateMnemonicWallet();
  try {
    const row: WalletSecretsData = {
      id: MAIN_WALLET.id,
      name: MAIN_WALLET.name,
      publicKey: wallet.address,
      source: "CREATED",
      ...vault.encrypt(wallet.secretKey, wallet.address),
      ...vault.encryptMnemonic(wallet.mnemonic, wallet.address),
    };
    return { row, mnemonic: wallet.mnemonic };
  } finally {
    wallet.secretKey.dispose();
  }
}

const account = (row: WalletSecretsData): UserSupportData => ({
  user: { ...TEST_USER, id: "target", telegramId: TARGET_ID },
  plan: { kind: "NONE" },
  history: [],
  payments: [],
  paymentCount: 0,
  wallets: [{ ...row, createdAt: new Date("2026-09-20T12:00:00Z") }],
  withdrawals: [],
  drafts: 0,
  simulations: 0,
  aiToday: null,
});

describe("no secret in the logs (§14, V1-46)", () => {
  it("import by key and seed, a stray key, Reveal keys, a withdrawal, a payment", async () => {
    const logs = captureLogs();
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
    const { row, mnemonic } = targetWallet();
    const support: Partial<SupportDataService> = {
      findUser: (telegramId) =>
        Promise.resolve(telegramId === TARGET_ID ? account(row).user : null),
      findUserById: () => Promise.resolve(account(row).user),
      loadUserSupportData: () => Promise.resolve(account(row)),
      walletSecrets: () => Promise.resolve([row]),
    };
    const h = botHarness({
      env: { ADMIN_TELEGRAM_IDS: [ADMIN_ID], WALLET_ENCRYPTION_KEY: MASTER_KEY },
      admin: { support },
    });
    // The first keys message is refused by Telegram: its error carries the keys in its payload.
    let refuse = true;
    h.bot.api.config.use((prev, method, payload, signal) => {
      const text = (payload as { text?: unknown }).text;
      if (refuse && method === "sendMessage" && String(text).includes("WALLET KEYS")) {
        refuse = false;
        const error = { ok: false as const, error_code: 400, description: "Bad Request: no" };
        return Promise.reject(
          new GrammyError("Call to 'sendMessage' failed!", error, method, payload),
        );
      }
      return prev(method, payload, signal);
    });
    const reveal = async () => {
      await feed(h.bot, textUpdate(`/getall ${TARGET_ID}`));
      const nonce = /adm:ga:rev:([A-Za-z0-9_-]+)/.exec(JSON.stringify(h.api.calls.at(-1)))?.[1];
      await feed(h.bot, callbackUpdate(ADMIN_CB.reveal(nonce ?? "none"), { messageId: 101 }));
    };

    // Reveal keys, refused once by Telegram, then sent: the key and the phrase in clear.
    await reveal();
    await reveal();
    const keysMessage = h.api.text("sendMessage", -1);
    const privateKey = /Private key: <code>([1-9A-HJ-NP-Za-km-z]+)<\/code>/.exec(keysMessage)?.[1];
    expect(parsePrivateKey(privateKey ?? "")).toMatchObject({ ok: true, address: row.publicKey });
    expect(keysMessage).toContain(mnemonic);

    // Imports, then the same secrets sent outside any import: in a text, in a caption.
    await feed(h.bot, callbackUpdate(WALLET_CB.importFormat("KEY")));
    await feed(h.bot, textUpdate(privateKey ?? ""));
    await feed(h.bot, callbackUpdate(WALLET_CB.importFormat("SEED")));
    await feed(h.bot, textUpdate(mnemonic));
    await feed(h.bot, textUpdate(privateKey ?? ""));
    await feed(h.bot, messageUpdate({ photo: [], caption: mnemonic }));

    // A withdrawal and a payment from a wallet, to their confirmation and their send.
    await feed(h.bot, callbackUpdate(WALLET_CB.withdraw(MAIN_WALLET.id)));
    await feed(h.bot, textUpdate(TEST_WALLET.publicKey));
    await feed(h.bot, callbackUpdate(WITHDRAW_CB.pct(25)));
    await feed(h.bot, callbackUpdate(confirmData(h.api)));
    await feed(h.bot, callbackUpdate(SUB_CB.payFromWallet(TEST_INVOICE_ID)));
    await feed(h.bot, callbackUpdate(PAY_CB.wallet(TEST_INVOICE_ID, MAIN_WALLET.id)));
    await feed(h.bot, callbackUpdate(confirmData(h.api)));

    // A group message: a debug line of the bot, to prove the level.
    await feed(h.bot, textUpdate("/start", { chat: { id: -100, type: "group", title: "g" } }));

    const written = [...logs, ...stderr].join("");
    const words = mnemonic.split(" ");
    const secrets = [
      privateKey ?? "no key",
      mnemonic,
      // Any three words in a row of the phrase.
      ...words.slice(0, -2).map((word, index) => `${word} ${words[index + 1]} ${words[index + 2]}`),
      TEST_ENV.BOT_TOKEN,
      Buffer.from(MASTER_KEY).toString("hex"),
      Buffer.from(MASTER_KEY).toString("base64"),
      "encSecretKey",
      "encMnemonic",
    ];
    for (const secret of secrets) expect(written).not.toContain(secret);

    // The scan read something: the logs of the flows, at debug, and grammY's debug output.
    expect(logs.join("")).toContain("admin.getall.reveal");
    expect(logs.join("")).toContain('"level":20');
    expect(stderr.join("")).toContain("grammy");
    expect(h.api.of("deleteMessage").length).toBeGreaterThanOrEqual(4);
  });
});
