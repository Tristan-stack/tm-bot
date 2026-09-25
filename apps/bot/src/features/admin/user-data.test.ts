import type {
  SupportDataService,
  SupportPayment,
  SupportWithdrawal,
  User,
  UserBalances,
  UserSupportData,
  WalletSecretsData,
} from "@launchbot/db";
import { createUi, DAY_MS, MINUTE_MS, TG } from "@launchbot/shared";
import type { PlanStatus } from "@launchbot/shared";
import { captureLogs, resetRateLimits, setLogDestination } from "@launchbot/shared/server";
import {
  createKeyVault,
  generateKeypair,
  generateMnemonicWallet,
  parsePrivateKey,
  parseSeedPhrase,
} from "@launchbot/solana";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  BALANCES_READ_AT,
  botHarness,
  buttonTexts,
  callbackUpdate,
  feed,
  MAIN_WALLET,
  storedSession,
  TEST_BALANCES,
  TEST_USER,
  TEST_WALLET,
  textUpdate,
} from "../../test-harness.js";
import type { AdminServices } from "./admin.js";
import { buildGetAllBlocks, buildGetAllMessages, buildWhoisScreen } from "./user-data-screens.js";

const ui = createUi("devnet");
const NOW = new Date("2026-09-15T14:32:00Z");
const TARGET: User = {
  ...TEST_USER,
  id: "cjld2cjxh0000qzrmn831target",
  telegramId: 555_000_111n,
  username: "alice",
  firstName: "Alice",
  createdAt: new Date("2026-09-02T09:00:00Z"),
  lastActiveAt: new Date("2026-09-15T14:30:00Z"),
  termsVersion: 1,
  termsAcceptedAt: new Date("2026-09-02T09:01:00Z"),
};
const DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
// Shaped like a signature, built at runtime: no 88-character base58 literal in the sources.
const SIGNATURE = `5Hq1${"x".repeat(80)}Zk9a`;

beforeEach(resetRateLimits);
afterEach(() => {
  setLogDestination(undefined);
});

const active = (plan: "CLASSIC" | "PREMIUM", expiresAt: Date): PlanStatus => ({
  kind: "ACTIVE",
  subscription: {
    plan,
    duration: "ONE_MONTH",
    startsAt: new Date(NOW.getTime() - DAY_MS),
    expiresAt,
  },
});

const payment = (overrides: Partial<SupportPayment> = {}): SupportPayment => ({
  plan: "PREMIUM",
  duration: "ONE_MONTH",
  priceUsd: "179.00",
  expectedLamports: 1_731_811_146n,
  receivedLamports: 1_731_811_146n,
  depositAddress: DEPOSIT,
  status: "PAID",
  createdAt: new Date("2026-09-15T14:32:00Z"),
  ...overrides,
});

const supportData = (overrides: Partial<UserSupportData> = {}): UserSupportData => ({
  user: TARGET,
  plan: { kind: "NONE" },
  history: [],
  payments: [],
  paymentCount: 0,
  wallets: [],
  withdrawals: [],
  drafts: 0,
  simulations: 0,
  aiToday: null,
  ...overrides,
});

const whois = (data: UserSupportData, typed: "P" | "C" | "F" | null = null) =>
  buildWhoisScreen(ui, {
    data,
    ref: { telegramId: TARGET.telegramId, claimedPlanLetter: typed },
    now: NOW,
  }).text;

describe("buildWhoisScreen (V1-43)", () => {
  it("an account without plan or payment", () => {
    expect(whois(supportData())).toBe(
      [
        "<b>👤 WHOIS</b> · 🧪 Devnet",
        "",
        "Check the plan before answering a support request.",
        "",
        "┌ @alice",
        "├ 🆔 <code>555000111</code>",
        "├ ⭐ No subscription",
        "├ Support code: <code>F-555000111</code>",
        "└ 👛 No wallet yet",
        "",
        "<b>🧾 LAST PAYMENTS</b>",
        "└ No payment yet.",
      ].join("\n"),
    );
  });

  it("the plan: the date in full, the time left under 72 h, the end of an expired one", () => {
    const later = whois(supportData({ plan: active("PREMIUM", new Date("2026-10-12T14:32:00Z")) }));
    const soon = whois(supportData({ plan: active("PREMIUM", new Date("2026-09-16T18:32:00Z")) }));
    const ended = whois(
      supportData({
        plan: {
          kind: "EXPIRED",
          subscription: {
            plan: "CLASSIC",
            duration: "TWO_DAYS",
            startsAt: new Date("2026-09-08T14:32:00Z"),
            expiresAt: new Date("2026-09-10T14:32:00Z"),
          },
        },
      }),
    );

    expect(later).toContain("├ ⭐ Premium · until 12 Oct 2026, 14:32 UTC");
    expect(later).toContain("├ Support code: <code>P-555000111</code>");
    expect(soon).toContain("├ ⭐ Premium · 1d 4h left · until 16 Sep 2026, 18:32 UTC");
    expect(ended).toContain("├ ⭐ Classic ⚠️ expired · ended 10 Sep 2026, 14:32 UTC");
    expect(ended).toContain("<code>F-555000111</code>");
  });

  it("the last 5 payments, what arrived on an unpaid one, the refund due", () => {
    const text = whois(
      supportData({
        payments: [
          payment(),
          payment({ status: "SWEPT", createdAt: new Date("2026-09-14T10:00:00Z") }),
          payment({
            duration: "TWO_DAYS",
            priceUsd: "59.00",
            expectedLamports: 570_820_434n,
            receivedLamports: 200_000_000n,
            status: "PENDING",
            createdAt: new Date("2026-09-10T18:05:00Z"),
          }),
          payment({ status: "EXPIRED", receivedLamports: 300_000_000n }),
          payment({ status: "CANCELED", receivedLamports: 0n }),
          payment({ status: "EXPIRED", receivedLamports: 0n }),
        ],
        paymentCount: 6,
        wallets: [
          {
            id: "w1",
            name: "Main",
            publicKey: MAIN_WALLET.publicKey,
            source: "CREATED",
            createdAt: NOW,
          },
        ],
      }),
    );

    expect(text).toContain("└ 👛 1 wallet");
    expect(text.split("\n").slice(-5)).toEqual([
      "┌ 15 Sep 2026, 14:32 UTC · Premium · 1 month · $179.00 · 1.7319 SOL · Paid",
      "├ 14 Sep 2026, 10:00 UTC · Premium · 1 month · $179.00 · 1.7319 SOL · Paid",
      "├ 10 Sep 2026, 18:05 UTC · Premium · 2 days · $59.00 · 0.5709 SOL · Pending (0.2000 SOL received)",
      "├ 15 Sep 2026, 14:32 UTC · Premium · 1 month · $179.00 · 1.7319 SOL · Expired (0.3000 SOL received) · refund manually",
      "└ 15 Sep 2026, 14:32 UTC · Premium · 1 month · $179.00 · 1.7319 SOL · Canceled",
    ]);
  });

  it("flags a code that does not say the plan of now", () => {
    const text = whois(
      supportData({ plan: active("CLASSIC", new Date("2026-10-12T14:32:00Z")) }),
      "P",
    );

    expect(text).toContain(
      "⚠️ Code <code>P-555000111</code> doesn't match the current plan. Current code: <code>C-555000111</code>.",
    );
    expect(whois(supportData(), "F")).not.toContain("doesn't match");
  });
});

const withdrawal = (overrides: Partial<SupportWithdrawal> = {}): SupportWithdrawal => ({
  createdAt: new Date("2026-09-14T10:02:00Z"),
  kind: "USER",
  walletName: "Main",
  fromAddress: MAIN_WALLET.publicKey,
  toAddress: DEPOSIT,
  lamports: 500_000_000n,
  status: "CONFIRMED",
  error: null,
  signature: SIGNATURE,
  ...overrides,
});

const fullAccount = () =>
  supportData({
    plan: active("PREMIUM", new Date("2026-10-15T14:32:00Z")),
    history: [
      {
        plan: "CLASSIC",
        duration: "TWO_DAYS",
        status: "EXPIRED",
        startsAt: new Date("2026-09-10T14:32:00Z"),
        expiresAt: new Date("2026-09-12T14:32:00Z"),
        fromPayment: false,
      },
    ],
    payments: [payment()],
    paymentCount: 1,
    wallets: [
      {
        id: "w1",
        name: "Main",
        publicKey: MAIN_WALLET.publicKey,
        source: "CREATED",
        createdAt: new Date("2026-09-12T09:00:00Z"),
      },
      {
        id: "w2",
        name: "Test",
        publicKey: TEST_WALLET.publicKey,
        source: "IMPORTED_KEY",
        createdAt: new Date("2026-09-13T09:00:00Z"),
      },
    ],
    withdrawals: [
      withdrawal(),
      withdrawal({
        walletName: null,
        status: "FAILED",
        error: `TRANSACTION_REJECTED: ${"x".repeat(100)}`,
        signature: null,
      }),
      withdrawal({ kind: "INACTIVITY_SWEEP", status: "PENDING", signature: null }),
    ],
    drafts: 3,
    simulations: 5,
    aiToday: 12,
  });

describe("buildGetAllBlocks (V1-43)", () => {
  it("everything support needs, and no key", () => {
    const blocks = buildGetAllBlocks(ui, {
      data: fullAccount(),
      balances: TEST_BALANCES,
      solUsd: 103.36,
      now: NOW,
    });

    expect(blocks).toEqual([
      "Everything support needs about this user. Keys stay hidden until you tap Reveal keys.",
      [
        "<b>👤 ACCOUNT</b>",
        "┌ @alice · Alice",
        "├ 🆔 <code>555000111</code>",
        "├ Support code: <code>P-555000111</code>",
        "├ Joined 2 Sep 2026 · Last active 15 Sep 2026, 14:30 UTC",
        "└ Terms v1 accepted 2 Sep 2026",
      ].join("\n"),
      [
        "<b>⭐ SUBSCRIPTION</b>",
        "┌ Premium · until 15 Oct 2026, 14:32 UTC",
        "├ AI Generate today: 12/50",
        "└ History:",
        "   · Classic · 2 days · 10 Sep → 12 Sep 2026 · Expired · Grant",
      ].join("\n"),
      [
        "<b>🧾 PURCHASES</b>",
        "└ 15 Sep 2026, 14:32 UTC · Premium · 1 month · $179.00 · 1.7319 SOL · Paid · to 9WzD…AWWM",
      ].join("\n"),
      [
        "<b>👛 WALLETS · 2 · 4.250 SOL ($439.28)</b>",
        "1. Main · Created · 12 Sep 2026",
        `   <code>${MAIN_WALLET.publicKey}</code>`,
        "   └ 💰 2.500 SOL ($258.40)",
        "2. Test · Imported (key) · 13 Sep 2026",
        `   <code>${TEST_WALLET.publicKey}</code>`,
        "   └ 💰 1.750 SOL ($180.88)",
      ].join("\n"),
      [
        "<b>📤 RECENT WITHDRAWALS</b>",
        `┌ 14 Sep 2026, 10:02 UTC · Main → 9WzD…AWWM · 0.500 SOL · Confirmed · <a href="https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet">Explorer</a>`,
        `├ 14 Sep 2026, 10:02 UTC · Deleted wallet → 9WzD…AWWM · 0.500 SOL · Failed: TRANSACTION_REJECTED: ${"x".repeat(58)}`,
        "└ 14 Sep 2026, 10:02 UTC · Inactivity sweep · Main → 9WzD…AWWM · 0.500 SOL · Pending",
      ].join("\n"),
      "📊 3 token drafts · 5 simulations",
      "🕒 Updated 14:32 UTC",
    ]);
    expect(blocks.join("\n")).not.toMatch(/Private key|Seed phrase/);
  });

  it("hides the USD without a price, says a balance it could not read", () => {
    const noPrice = buildGetAllBlocks(ui, {
      data: fullAccount(),
      balances: TEST_BALANCES,
      solUsd: null,
      now: NOW,
    }).join("\n");
    const unavailable: UserBalances = {
      ...TEST_BALANCES,
      wallets: TEST_BALANCES.wallets.map((wallet) => ({ ...wallet, lamports: null })),
      totalLamports: null,
      status: "unavailable",
    };
    const down = buildGetAllBlocks(ui, {
      data: fullAccount(),
      balances: unavailable,
      solUsd: 103.36,
      now: NOW,
    }).join("\n");

    expect(noPrice).toContain("<b>👛 WALLETS · 2 · 4.250 SOL</b>");
    expect(noPrice).not.toContain("$258.40");
    expect(down).toContain("<b>👛 WALLETS · 2</b>");
    expect(down).toContain("   └ 💰 Balance unavailable");
  });

  it("says what is empty, and how many purchases are not shown", () => {
    const empty = buildGetAllBlocks(ui, {
      data: supportData(),
      balances: { ...TEST_BALANCES, wallets: [], totalLamports: 0n },
      solUsd: 103.36,
      now: NOW,
    });
    const many = buildGetAllBlocks(ui, {
      data: supportData({
        payments: Array.from({ length: 20 }, () => payment()),
        paymentCount: 34,
      }),
      balances: TEST_BALANCES,
      solUsd: 103.36,
      now: NOW,
    }).join("\n");

    expect(empty.join("\n")).toContain("<b>🧾 PURCHASES</b>\n└ No purchase yet.");
    expect(empty.join("\n")).toContain("<b>👛 WALLETS · 0</b>\nNo wallet yet.");
    expect(empty.join("\n")).toContain("<b>📤 RECENT WITHDRAWALS</b>\n└ No withdrawal yet.");
    expect(empty.join("\n")).toContain("Terms v1 accepted");
    expect(many).toContain("<b>🧾 PURCHASES · 20 of 34</b>");
  });

  it("splits a long card into messages Telegram accepts, the header on each", () => {
    const data = supportData({
      payments: Array.from({ length: 20 }, () => payment()),
      paymentCount: 20,
      withdrawals: Array.from({ length: 10 }, () => withdrawal()),
      wallets: Array.from({ length: 10 }, (_, index) => ({
        id: `w${index}`,
        name: `Wallet ${index}`,
        publicKey: MAIN_WALLET.publicKey,
        source: "CREATED" as const,
        createdAt: NOW,
      })),
    });

    const parts = buildGetAllMessages(ui, {
      data,
      balances: TEST_BALANCES,
      solUsd: 103.36,
      now: NOW,
    });

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(TG.MESSAGE_MAX_CHARS);
      expect(part.startsWith("<b>🗂 USER DATA</b> · 🧪 Devnet\n\nPart ")).toBe(true);
    }
  });
});

/** Two real wallets of the target, encrypted with the key of the bot of the tests. */
function encryptedWallets(): {
  rows: WalletSecretsData[];
  created: string;
  imported: string;
  mnemonic: string;
} {
  const vault = createKeyVault(new Uint8Array(32));
  const created = generateMnemonicWallet();
  const imported = generateKeypair();
  try {
    const rows: WalletSecretsData[] = [
      {
        id: "w1",
        name: "Main",
        publicKey: created.address,
        source: "CREATED",
        ...vault.encrypt(created.secretKey, created.address),
        ...vault.encryptMnemonic(created.mnemonic, created.address),
      },
      {
        id: "w2",
        name: "Test",
        publicKey: imported.address,
        source: "IMPORTED_KEY",
        ...vault.encrypt(imported.secretKey, imported.address),
        encMnemonic: null,
        mnemonicIv: null,
        mnemonicAuthTag: null,
      },
    ];
    return {
      rows,
      created: created.address,
      imported: imported.address,
      mnemonic: created.mnemonic,
    };
  } finally {
    created.secretKey.dispose();
    imported.secretKey.dispose();
  }
}

describe("/getall and Reveal keys (V1-43)", () => {
  function harness(
    options: { rows?: WalletSecretsData[]; wallets?: boolean; sweeps?: SupportWithdrawal[] } = {},
  ) {
    const walletSecrets = vi.fn<SupportDataService["walletSecrets"]>(() =>
      Promise.resolve(options.rows ?? []),
    );
    const schedule = vi.fn<AdminServices["sensitive"]["schedule"]>(() => Promise.resolve());
    const loaded = options.wallets === false ? supportData() : fullAccount();
    const h = botHarness({
      env: { ADMIN_TELEGRAM_IDS: [ADMIN_ID] },
      admin: {
        support: {
          findUser: (telegramId) =>
            Promise.resolve(telegramId === TARGET.telegramId ? TARGET : null),
          findUserById: (id) => Promise.resolve(id === TARGET.id ? TARGET : null),
          loadUserSupportData: () => Promise.resolve(loaded),
          treasurySweeps: () => Promise.resolve(options.sweeps ?? []),
          walletSecrets,
        },
        sensitive: { schedule },
      },
    });
    const buttons = () => h.api.keyboard("sendMessage", -1);
    const dataOf = (row: number, column: number) => {
      const button = buttons()[row]?.[column];
      return button !== undefined && "callback_data" in button ? button.callback_data : "";
    };
    return { ...h, walletSecrets, schedule, buttons, dataOf };
  }

  it("sends the card with Reveal keys and Cancel, and reads no key", async () => {
    const h = harness();

    await feed(h.bot, textUpdate(`/getall ${TARGET.telegramId}`));

    expect(h.api.text("sendMessage", -1)).toContain("<b>🗂 USER DATA</b> · 🧪 Devnet");
    expect(buttonTexts({ inline_keyboard: h.buttons() })).toEqual([
      ["🔑 Reveal keys", "❌ Cancel"],
    ]);
    const request = storedSession(h.prisma)?.getallReveal;
    expect(request?.nonce).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(h.dataOf(0, 0)).toBe(`adm:ga:rev:${request?.nonce}`);
    expect(h.walletSecrets).not.toHaveBeenCalled();
  });

  it("gives no keyboard to an account without a wallet", async () => {
    const h = harness({ wallets: false });

    await feed(h.bot, textUpdate(`/getall F-${TARGET.telegramId}`));

    expect(h.buttons()).toEqual([]);
    expect(storedSession(h.prisma)?.getallReveal).toBeUndefined();
  });

  it("finds the transfers of a deleted account, for inactivity or by /purge", async () => {
    const h = harness({
      sweeps: [
        withdrawal({
          kind: "PURGE_SWEEP",
          walletName: null,
          lamports: 999_995_000n,
          createdAt: new Date("2026-09-20T08:00:00Z"),
        }),
        withdrawal({ kind: "INACTIVITY_SWEEP", walletName: null, lamports: 2_499_985_000n }),
      ],
    });

    await feed(h.bot, textUpdate("/getall 777000"));

    const explorer = `<a href="https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet">Explorer</a>`;
    expect(h.api.text("sendMessage")).toBe(
      [
        "<b>🗂 USER DATA</b> · 🧪 Devnet",
        "",
        "❌ User not found.",
        "Searched: 777000",
        "",
        "Account deleted. Transfers to treasury:",
        `· 20 Sep 2026, 08:00 UTC · Purge sweep · 7xKX…gAsU → 9WzD…AWWM · 0.999995 SOL · Confirmed · ${explorer}`,
        `· 14 Sep 2026, 10:02 UTC · Inactivity sweep · 7xKX…gAsU → 9WzD…AWWM · 2.499985 SOL · Confirmed · ${explorer}`,
      ].join("\n"),
    );
    expect(h.buttons()).toEqual([]);
  });

  it("reveals each key and phrase once, in messages deleted 60 s after their send", async () => {
    const logs = captureLogs();
    const { rows, created, imported, mnemonic } = encryptedWallets();
    const h = harness({ rows });
    await feed(h.bot, textUpdate(`/getall ${TARGET.telegramId}`));
    const card = h.api.of("sendMessage").length;
    const reveal = h.dataOf(0, 0);
    const sentAt = Date.now();

    await feed(h.bot, callbackUpdate(reveal, { messageId: 101 }));

    // The card loses its buttons; the keys come in a message of their own.
    expect(h.api.of("editMessageReplyMarkup")[0]?.payload).toMatchObject({ message_id: 101 });
    const keys = h.api.of("sendMessage").slice(card);
    expect(keys).toHaveLength(1);
    const message = keys[0]?.payload ?? {};
    expect(message).toMatchObject({ parse_mode: "HTML", protect_content: false });
    const text = String(message["text"]);
    expect(text).toContain("<b>🔑 WALLET KEYS</b> · 🧪 Devnet");
    expect(text).toContain("@alice · 🆔 <code>555000111</code> · 2 wallets");
    expect(text).toContain("🌱 Seed phrase: none (imported with a private key)");
    expect(text).toContain("This message will be deleted in 60 s.");

    // Imported back, they give the same addresses.
    const keysText = [...text.matchAll(/Private key: <code>([1-9A-HJ-NP-Za-km-z]+)<\/code>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(
      keysText.map((key) => {
        const parsed = parsePrivateKey(key);
        return parsed.ok ? parsed.address : null;
      }),
    ).toEqual([created, imported]);
    const phrase = /Seed phrase: <code>([a-z ]+)<\/code>/.exec(text)?.[1] ?? "";
    expect(phrase).toBe(mnemonic);
    const fromPhrase = parseSeedPhrase(phrase);
    expect(fromPhrase.ok && fromPhrase.address).toBe(created);

    expect(h.schedule).toHaveBeenCalledOnce();
    const [chatId, messageId, deleteAt] = h.schedule.mock.calls[0] ?? [];
    expect([chatId, messageId]).toEqual([777n, expect.any(Number)]);
    expect((deleteAt?.getTime() ?? 0) - sentAt).toBeGreaterThanOrEqual(60_000);
    expect((deleteAt?.getTime() ?? 0) - sentAt).toBeLessThan(65_000);

    // Once only, and never in a log.
    await feed(h.bot, callbackUpdate(reveal, { messageId: 101 }));
    expect(h.walletSecrets).toHaveBeenCalledOnce();
    expect(h.api.lastAlert()).toMatchObject({
      text: "This request has expired. Send /getall again.",
    });
    const logged = logs.join("\n");
    expect(logged).toContain("admin.getall.reveal");
    for (const secret of [...keysText, mnemonic.split(" ").slice(0, 3).join(" ")]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("refuses a request of 5 minutes, or of another card, and reads no key", async () => {
    const h = harness({ rows: encryptedWallets().rows });
    await feed(h.bot, textUpdate(`/getall ${TARGET.telegramId}`));
    const reveal = h.dataOf(0, 0);
    const session = storedSession(h.prisma);
    h.prisma.sessions.set(
      "777",
      JSON.stringify({
        ...session,
        getallReveal: { ...session?.getallReveal, createdAt: Date.now() - 5 * MINUTE_MS },
      }),
    );

    await feed(h.bot, callbackUpdate(reveal));
    await feed(h.bot, callbackUpdate("adm:ga:rev:AAAAAAAAAAAAAAAA"));

    expect(h.walletSecrets).not.toHaveBeenCalled();
    expect(h.api.of("answerCallbackQuery").map((call) => call.payload["text"])).toEqual([
      "This request has expired. Send /getall again.",
      "This request has expired. Send /getall again.",
    ]);
    expect(h.api.text("sendMessage", -1)).toContain(
      "⌛ This request has expired. Send /getall again.",
    );
  });

  it("Cancel reads no key and says so", async () => {
    const h = harness({ rows: encryptedWallets().rows });
    await feed(h.bot, textUpdate(`/getall ${TARGET.telegramId}`));

    await feed(h.bot, callbackUpdate(h.dataOf(0, 1), { messageId: 101 }));

    expect(h.walletSecrets).not.toHaveBeenCalled();
    expect(h.api.of("editMessageReplyMarkup")[0]?.payload).toMatchObject({ message_id: 101 });
    expect(h.api.text("sendMessage", -1)).toContain("❌ Canceled. No keys were revealed.");
    expect(storedSession(h.prisma)?.getallReveal).toBeUndefined();
  });

  it("says a wallet it cannot decrypt, the others still revealed", async () => {
    const { rows } = encryptedWallets();
    // Encrypted with another master key: the vault of the bot refuses it.
    const other = createKeyVault(new Uint8Array(32).fill(7));
    const foreign = generateKeypair();
    const broken: WalletSecretsData = {
      id: "w3",
      name: "Old",
      publicKey: foreign.address,
      source: "IMPORTED_KEY",
      ...other.encrypt(foreign.secretKey, foreign.address),
      encMnemonic: null,
      mnemonicIv: null,
      mnemonicAuthTag: null,
    };
    foreign.secretKey.dispose();
    captureLogs();
    const h = harness({ rows: [...rows, broken] });
    await feed(h.bot, textUpdate(`/getall ${TARGET.telegramId}`));

    await feed(h.bot, callbackUpdate(h.dataOf(0, 0)));

    const text = h.api.text("sendMessage", -1);
    expect(text).toContain("3. Old · Imported (key)");
    expect(text).toContain("❌ Keys unavailable (decryption failed).");
    expect(text.match(/Private key: <code>/g)).toHaveLength(2);
  });

  it("stops at a send Telegram refuses, and never logs the payload", async () => {
    const logs = captureLogs();
    const h = harness({ rows: encryptedWallets().rows });
    await feed(h.bot, textUpdate(`/getall ${TARGET.telegramId}`));
    const reveal = h.dataOf(0, 0);
    let sends = 0;
    h.bot.api.config.use((prev, method, payload, signal) => {
      if (method === "sendMessage" && sends++ === 0) {
        return Promise.resolve({
          ok: false,
          error_code: 400,
          description: "Bad Request: chat not found",
        } as never);
      }
      return prev(method, payload, signal);
    });

    await feed(h.bot, callbackUpdate(reveal));

    expect(h.schedule).not.toHaveBeenCalled();
    expect(h.api.text("sendMessage", -1)).toContain(
      "❌ Couldn't send the keys. Send /getall again.",
    );
    expect(logs.join("\n")).toContain("admin.getall.send_failed");
    expect(logs.join("\n")).not.toContain("Private key");
  });

  it("the card reads the balances as the screens do, cached", async () => {
    const h = harness();

    await feed(h.bot, textUpdate(`/getall ${TARGET.telegramId}`));

    expect(h.api.text("sendMessage", -1)).toContain(
      `🕒 Updated ${BALANCES_READ_AT.toISOString().slice(11, 16)} UTC`,
    );
  });
});
