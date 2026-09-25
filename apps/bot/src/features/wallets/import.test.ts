import type { WalletImportResult, WalletService } from "@launchbot/db";
import {
  createUi,
  en,
  IMPORT_INPUT_TIMEOUT_MS,
  isCallbackDataSize,
  RATE_LIMITS,
} from "@launchbot/shared";
import { captureLogs, resetRateLimits, setLogDestination } from "@launchbot/shared/server";
import { TWELVE_WORDS } from "@launchbot/solana/test";
import type { Bot } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../../context.js";
import {
  botHarness,
  callbackUpdate,
  editedTextUpdate,
  feed,
  keyboardOf,
  MAIN_WALLET,
  NEW_USER,
  photoUpdate,
  storedSession,
  telegramError,
  TEST_BALANCES,
  TEST_USER,
  TEST_WALLET,
  textUpdate,
} from "../../test-harness.js";
import { buildImportInputScreen, buildImportScreen, WALLET_CB } from "./screens.js";

const ui = createUi("devnet");
/** The 12-word vector of V1-09: the heuristics recognize it as a phrase. */
const SEED = TWELVE_WORDS;
/** The `[12,34,…]` export of solana-keygen, 64 bytes: sensitive, and no secret of ours. */
const KEY_ARRAY = `[${Array.from({ length: 64 }, (_value, index) => index).join(",")}]`;
const QUOTA = "👛 Wallets: 2/3";
const T0 = new Date("2026-09-22T14:32:00Z");

/** Arms one input, so every test below reads its answer at `editMessageText` index 1. */
const arm = (bot: Bot<BotContext>, format: "KEY" | "SEED" = "SEED") =>
  feed(bot, callbackUpdate(WALLET_CB.importFormat(format)));

/** The service answering "imported", with the wallet the detail screen can render. */
const imports = (result: WalletImportResult = { ok: true, wallet: TEST_WALLET }) =>
  vi.fn<WalletService["importWallet"]>(() => Promise.resolve(result));

/** A user at the limit of their plan: the quota and the list agree, as they do in the database. */
const atLimit = (): Partial<WalletService> => ({
  getQuota: () => Promise.resolve({ count: 3, limit: 3, reached: true }),
  listWithBalances: () => Promise.resolve({ ...TEST_BALANCES, count: 3, limit: 3 }),
});

beforeEach(resetRateLimits);
afterEach(() => {
  vi.useRealTimers();
  setLogDestination(undefined);
});

describe("buildImportScreen", () => {
  it("renders the mockup of §9.4, with the counter of the plan", () => {
    const screen = buildImportScreen(ui, { count: 2, limit: 5 });

    expect(screen.text).toBe(
      [
        "<b>📥 IMPORT WALLET</b> · 🧪 Devnet",
        "",
        "⚠️ Never import a wallet that holds real funds. The same key also works on mainnet.",
        "",
        "Choose the format of the key you want to import.",
        "",
        "👛 Wallets: 2/5",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "🔑 Private key", callback_data: "wal:imp:key" },
        { text: "🌱 Seed phrase", callback_data: "wal:imp:seed" },
      ],
      [{ text: "⬅️ Back", callback_data: "wal:list" }],
    ]);
  });

  it("writes what went wrong last, under the counter", () => {
    const flags = [en.wallets.import.duplicate, en.wallets.sensitive.notDeleted];

    expect(
      buildImportScreen(ui, { count: 2, limit: 5 }, { flags }).text.endsWith(
        [
          "👛 Wallets: 2/5",
          "",
          "⚠️ This wallet is already in your list.",
          "⚠️ Couldn't delete your message. Delete it yourself now.",
        ].join("\n"),
      ),
    ).toBe(true);
  });
});

describe("buildImportInputScreen", () => {
  const expiresAt = new Date("2026-09-22T14:34:00Z");

  it("asks for a private key, with its format and its expiry", () => {
    const screen = buildImportInputScreen(ui, "KEY", expiresAt);

    expect(screen.text).toBe(
      [
        "<b>🔑 IMPORT PRIVATE KEY</b> · 🧪 Devnet",
        "",
        "Send your private key in one message. It is deleted from the chat right after reading.",
        "",
        "Format: base58 private key (64 bytes), as exported from Phantom or Solflare.",
        "⌛ Expires at 14:34 UTC",
      ].join("\n"),
    );
    // §15: every input has a Cancel, and it goes back to the list (§9.4).
    expect(keyboardOf(screen)).toEqual([[{ text: "❌ Cancel", callback_data: "wal:list" }]]);
  });

  it("asks for a seed phrase, says where it is stored, and never shows a value", () => {
    const text = buildImportInputScreen(ui, "SEED", expiresAt, {
      flags: [en.wallets.import.invalid.SEED],
    }).text;

    expect(text).toContain("<b>🌱 IMPORT SEED PHRASE</b> · 🧪 Devnet");
    expect(text).toContain(
      "Format: 12 or 24 words separated by spaces. The first account (m/44'/501'/0'/0') is imported: same address as Phantom or Solflare. Your seed phrase is stored encrypted. Only support can recover it for you.",
    );
    expect(text).not.toContain("Current:");
    expect(text.endsWith("⌛ Expires at 14:34 UTC\n\n❌ Invalid seed phrase.")).toBe(true);
  });

  it("keeps the callbacks of the two formats within 64 bytes", () => {
    expect(isCallbackDataSize(WALLET_CB.importFormat("KEY"))).toBe(true);
    expect(isCallbackDataSize(WALLET_CB.importFormat("SEED"))).toBe(true);
  });
});

describe("import handlers", () => {
  it("opens the choice of a format from the list", async () => {
    const { bot, api } = botHarness();

    await feed(bot, callbackUpdate(WALLET_CB.import));

    const text = api.text("editMessageText");
    expect(text).toContain("<b>📥 IMPORT WALLET</b> · 🧪 Devnet");
    expect(text).toContain("⚠️ Never import a wallet that holds real funds.");
    expect(text).toContain(QUOTA);
  });

  it.each([
    ["the choice", WALLET_CB.import],
    ["an input", WALLET_CB.importFormat("SEED")],
  ])("never opens %s at the limit: the list says so", async (_label, data) => {
    const { bot, api, prisma } = botHarness({ wallets: atLimit() });

    await feed(bot, callbackUpdate(data));

    expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "Wallet limit reached. Upgrade to get more.",
      show_alert: true,
    });
    const text = api.text("editMessageText");
    expect(text).toContain("<b>👛 WALLETS · 3/3 · limit reached</b>");
    expect(text).toContain("⚠️ Wallet limit reached. Upgrade to get more.");
    expect(storedSession(prisma)?.pendingInput).toBeUndefined();
  });

  it("reads the quota without reading any balance", async () => {
    const listWithBalances = vi.fn<WalletService["listWithBalances"]>();
    const { bot, api } = botHarness({ wallets: { listWithBalances } });

    await feed(bot, callbackUpdate(WALLET_CB.import));

    expect(api.text("editMessageText")).toContain(QUOTA);
    expect(listWithBalances).not.toHaveBeenCalled();
  });

  it("arms the input for two minutes and remembers only the format", async () => {
    vi.useFakeTimers({ now: T0 });
    const { bot, api, prisma } = botHarness();

    await arm(bot, "KEY");

    expect(api.text("editMessageText")).toContain("⌛ Expires at 14:34 UTC");
    expect(storedSession(prisma)?.pendingInput).toEqual({
      kind: "wallet_import",
      format: "KEY",
      expiresAt: T0.getTime() + IMPORT_INPUT_TIMEOUT_MS,
    });
  });

  it("deletes the message, imports it, and opens the detail with the notice", async () => {
    const importWallet = imports();
    const { bot, api, prisma } = botHarness({ wallets: { importWallet } });
    await arm(bot);
    const before = api.calls.length;

    await feed(bot, textUpdate(SEED));

    expect(importWallet).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, "SEED", SEED);
    // The first call of the update: nothing looked at the text before it was gone.
    expect(api.calls[before]).toMatchObject({
      method: "deleteMessage",
      payload: { message_id: 10 },
    });
    const text = api.text("editMessageText", 1);
    expect(text).toContain("<b>👛 Test</b>");
    expect(text.endsWith("✅ Wallet imported.")).toBe(true);
    expect(api.of("sendMessage")).toEqual([]);
    expect(storedSession(prisma)?.pendingInput).toBeUndefined();
  });

  it("deletes the message even when the import throws", async () => {
    const { bot, api } = botHarness({
      wallets: { importWallet: () => Promise.reject(new Error("vault unavailable")) },
    });
    await arm(bot);
    const before = api.calls.length;

    await feed(bot, textUpdate(SEED));

    // Deleted before the import was even attempted: a failure leaves nothing in the chat.
    expect(api.calls[before]?.method).toBe("deleteMessage");
    expect(api.text("sendMessage")).toBe(en.common.genericError);
  });

  it("says so on the next screen when Telegram refuses the deletion, without retrying it", async () => {
    const { bot, api } = botHarness({
      replies: {
        deleteMessage: telegramError("deleteMessage", "Bad Request: message can't be deleted"),
      },
      wallets: { importWallet: imports({ ok: false, reason: "duplicate" }) },
    });
    await arm(bot);

    await feed(bot, textUpdate(SEED));

    // A refusal Telegram will repeat is not retried.
    expect(api.of("deleteMessage")).toHaveLength(1);
    const text = api.text("editMessageText", 1);
    expect(text).toContain("⚠️ This wallet is already in your list.");
    expect(text).toContain("⚠️ Couldn't delete your message. Delete it yourself now.");
  });

  it.each<[string, WalletImportResult, string]>([
    [
      "a secret that does not parse",
      { ok: false, reason: "invalid_secret" },
      "❌ Invalid seed phrase.",
    ],
    [
      "a wallet already in the list",
      { ok: false, reason: "duplicate" },
      "⚠️ This wallet is already in your list.",
    ],
  ])("writes the outcome of %s on the screen", async (_label, result, flag) => {
    const { bot, api } = botHarness({ wallets: { importWallet: imports(result) } });
    await arm(bot);

    await feed(bot, textUpdate(SEED));

    const text = api.text("editMessageText", 1);
    expect(text.endsWith(flag)).toBe(true);
    expect(text).not.toContain("abandon");
  });

  it("re-arms the input after a bad format, with a new window", async () => {
    vi.useFakeTimers({ now: T0 });
    const { bot, api, prisma } = botHarness({
      wallets: { importWallet: imports({ ok: false, reason: "invalid_secret" }) },
    });
    await arm(bot, "KEY");

    vi.setSystemTime(new Date("2026-09-22T14:33:00Z"));
    await feed(bot, textUpdate("not-a-key"));

    const text = api.text("editMessageText", 1);
    expect(text).toContain("<b>🔑 IMPORT PRIVATE KEY</b>");
    expect(text).toContain("⌛ Expires at 14:35 UTC");
    expect(text.endsWith("❌ Invalid private key.")).toBe(true);
    expect(storedSession(prisma)?.pendingInput).toMatchObject({ format: "KEY" });
  });

  it("asks again when the message carries no text at all", async () => {
    const { bot, api } = botHarness();
    await arm(bot);

    await feed(bot, photoUpdate());

    expect(api.of("deleteMessage")).toHaveLength(1);
    expect(api.text("editMessageText", 1).endsWith("❌ Invalid seed phrase.")).toBe(true);
  });

  it("reads the caption of a photo as the secret", async () => {
    const importWallet = imports();
    const { bot } = botHarness({ wallets: { importWallet } });
    await arm(bot);

    await feed(bot, photoUpdate(SEED));

    expect(importWallet).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, "SEED", SEED);
  });

  it("ignores a secret that arrives after two minutes, and still deletes it", async () => {
    vi.useFakeTimers({ now: T0 });
    const importWallet = vi.fn<WalletService["importWallet"]>();
    const { bot, api, prisma } = botHarness({ wallets: { importWallet } });
    await arm(bot);

    vi.setSystemTime(new Date("2026-09-22T14:34:01Z"));
    await feed(bot, textUpdate(SEED));

    expect(api.of("deleteMessage")).toHaveLength(1);
    expect(importWallet).not.toHaveBeenCalled();
    const text = api.text("editMessageText", 1);
    expect(text).toContain("<b>📥 IMPORT WALLET</b>");
    expect(text.endsWith("⌛ Import expired. Please start again.")).toBe(true);
    expect(storedSession(prisma)?.pendingInput).toBeUndefined();
  });

  it("stops after five attempts in ten minutes", async () => {
    const importWallet = imports({ ok: false, reason: "invalid_secret" });
    const { bot, api } = botHarness({ wallets: { importWallet } });
    await arm(bot);

    const { limit } = RATE_LIMITS.walletImport;
    for (let attempt = 0; attempt < limit + 1; attempt++) await feed(bot, textUpdate(SEED));

    expect(importWallet).toHaveBeenCalledTimes(limit);
    // Deleted every time, refused or not.
    expect(api.of("deleteMessage")).toHaveLength(limit + 1);
    // The input screen, then one screen per attempt: the last one is the refusal.
    expect(api.text("editMessageText", limit + 1)).toContain(
      "⚠️ Too many import attempts. Try again in a few minutes.",
    );
  });

  it("sends the user back to the list when the last slot was taken meanwhile", async () => {
    const { bot, api } = botHarness({
      wallets: { importWallet: imports({ ok: false, reason: "limit_reached" }) },
    });
    await arm(bot);

    await feed(bot, textUpdate(SEED));

    const text = api.text("editMessageText", 1);
    expect(text).toContain("<b>👛 WALLETS");
    expect(text).toContain("⚠️ Wallet limit reached. Upgrade to get more.");
  });

  it("gives up the input on Cancel, and on a command", async () => {
    const importWallet = vi.fn<WalletService["importWallet"]>();
    const cancelled = botHarness({ wallets: { importWallet } });
    await arm(cancelled.bot);

    await feed(cancelled.bot, callbackUpdate(WALLET_CB.list));
    expect(storedSession(cancelled.prisma)?.pendingInput).toBeUndefined();

    const commanded = botHarness({ wallets: { importWallet } });
    await arm(commanded.bot);
    const before = commanded.api.calls.length;

    await feed(commanded.bot, textUpdate("/start"));

    // A command keeps its course: not deleted, and the home screen drops the input.
    expect(commanded.api.of("deleteMessage")).toEqual([]);
    expect(commanded.api.calls.length).toBeGreaterThan(before);
    expect(storedSession(commanded.prisma)?.pendingInput).toBeUndefined();
    expect(importWallet).not.toHaveBeenCalled();
  });
});

describe("sensitive message guard", () => {
  const WARNING =
    "⚠️ Your message looked like a private key or seed phrase, so it was deleted. Never share it with anyone. To add a wallet, use 👛 Wallets › 📥 Import.";

  it.each([
    ["a seed phrase", () => textUpdate(SEED)],
    ["a key as a JSON array", () => textUpdate(KEY_ARRAY)],
    ["a caption", () => photoUpdate(SEED)],
    ["an edited message", () => editedTextUpdate(SEED)],
  ])(
    "deletes %s sent outside an import, and warns without touching the screen",
    async (_label, update) => {
      const { bot, api } = botHarness();

      await feed(bot, update());

      expect(api.of("deleteMessage")).toHaveLength(1);
      expect(api.text("sendMessage")).toBe(WARNING);
      expect(api.of("editMessageText")).toEqual([]);
    },
  );

  it("stops the chain: an input opened for something else never sees it", async () => {
    const rename = vi.fn<WalletService["rename"]>();
    const { bot, api, prisma } = botHarness({ wallets: { rename } });
    await feed(bot, callbackUpdate(WALLET_CB.rename("w1")));

    await feed(bot, textUpdate(SEED));

    expect(rename).not.toHaveBeenCalled();
    expect(api.of("deleteMessage")).toHaveLength(1);
    // The rename is still armed: the user can send a name next.
    expect(storedSession(prisma)?.pendingInput).toMatchObject({ kind: "wallet_rename" });
  });

  it.each([
    ["a public address", MAIN_WALLET.publicKey],
    ["a name that is 12 short words", "my main wallet for the launch of the new test coin"],
    ["ordinary text", "how do I create a wallet?"],
  ])("leaves %s alone", async (_label, text) => {
    const { bot, api } = botHarness();

    await feed(bot, textUpdate(text));

    expect(api.of("deleteMessage")).toEqual([]);
    expect(api.of("sendMessage")).toEqual([]);
  });

  it("deletes it even when the user is over the global rate limit", async () => {
    const { bot, api } = botHarness();
    for (let update = 0; update < RATE_LIMITS.global.limit; update++) {
      await feed(bot, textUpdate("hello"));
    }
    const before = api.calls.length;

    await feed(bot, textUpdate(SEED));

    expect(api.calls.slice(before).map((call) => call.method)).toEqual([
      "deleteMessage",
      "sendMessage",
    ]);
  });

  it("deletes it before the channel is joined, and records the activity", async () => {
    const { bot, api, prisma } = botHarness({ user: NEW_USER });

    await feed(bot, textUpdate(SEED));

    expect(api.of("deleteMessage")).toHaveLength(1);
    expect(api.text("sendMessage")).toBe(WARNING);
    // V1-45 counts on lastActiveAt, whatever the message was.
    expect(prisma.upserts).toHaveLength(1);
  });

  it("says so when Telegram refuses the deletion", async () => {
    const { bot, api } = botHarness({
      replies: {
        deleteMessage: telegramError("deleteMessage", "Bad Request: message can't be deleted"),
      },
    });

    await feed(bot, textUpdate(SEED));

    expect(api.text("sendMessage")).toBe(
      `${en.wallets.sensitive.notDeleted} ${en.wallets.sensitive.advice}`,
    );
  });
});

describe("no leak", () => {
  it("keeps the secret out of the logs, of the session, of an error and of what we send", async () => {
    const lines = captureLogs();
    /**
     * One outcome per call: imported, refused, then a failure of our own. The service reports a
     * bad format as a code and never quotes the secret in an error (V1-09), so the logged error
     * is a plain one.
     */
    const outcomes: (() => Promise<never> | Promise<WalletImportResult>)[] = [
      () => Promise.resolve<WalletImportResult>({ ok: true, wallet: TEST_WALLET }),
      () => Promise.resolve<WalletImportResult>({ ok: false, reason: "invalid_secret" }),
      () => Promise.reject(new Error("vault unavailable")),
    ];
    const { bot, api, prisma } = botHarness({
      wallets: { importWallet: () => (outcomes.shift() ?? (() => Promise.reject(new Error())))() },
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      await arm(bot);
      await feed(bot, textUpdate(SEED));
    }
    // And one sent outside any import, which the guard deletes.
    await feed(bot, textUpdate(SEED));

    const written = [
      lines.join(""),
      JSON.stringify([...prisma.sessions.values()]),
      JSON.stringify(api.calls),
    ].join("");
    expect(written).not.toContain("abandon");
    // Something was logged and sent: the assertions above are not empty.
    expect(lines.join("")).toContain("Update failed");
    expect(api.of("deleteMessage")).toHaveLength(4);
    expect(storedSession(prisma)).toBeDefined();
  });
});
