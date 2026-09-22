import type { WalletDetailData, WalletListData, WalletService } from "@launchbot/db";
import { createUi, en, isCallbackDataSize } from "@launchbot/shared";
import { resetRateLimits } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MENU } from "../home/screen.js";
import {
  botHarness,
  callbackUpdate,
  feed,
  photoUpdate,
  storedSession,
  telegramError,
  TEST_BALANCES,
  TEST_USER,
  textUpdate,
} from "../../test-harness.js";
import {
  buildDeleteBlockedScreen,
  buildDeleteConfirmScreen,
  buildImportSoonScreen,
  buildRenameScreen,
  buildWalletDetailScreen,
  buildWalletListScreen,
  buildWithdrawSoonScreen,
  WALLET_CB,
} from "./screens.js";
import type { WalletDetailView, WalletListView } from "./screens.js";

const ui = createUi("devnet");
const UUID = "123e4567-e89b-12d3-a456-426614174000";
const [MAIN, TEST] = TEST_BALANCES.wallets as [
  WalletDetailData["wallet"],
  WalletDetailData["wallet"],
];

/** The two wallets of the mockup of §9.1, under a Classic plan. */
const list = (overrides: Partial<WalletListView> = {}): WalletListView => ({
  ...TEST_BALANCES,
  count: 2,
  limit: 5,
  solUsd: 103.36,
  ...overrides,
});

const detail = (overrides: Partial<WalletDetailView["wallet"]> = {}): WalletDetailView => ({
  wallet: { ...MAIN, ...overrides },
  fetchedAt: TEST_BALANCES.fetchedAt,
  status: "fresh",
  solUsd: 103.36,
});

const listText = (view: WalletListView, flag?: string) =>
  buildWalletListScreen(ui, view, { flag }).text;
const keyboardOf = (screen: { reply_markup: { inline_keyboard: unknown[][] } }) =>
  screen.reply_markup.inline_keyboard;

beforeEach(resetRateLimits);

describe("buildWalletListScreen", () => {
  it("renders the mockup of §9.1", () => {
    expect(listText(list())).toBe(
      [
        "<b>👛 WALLETS · 2/5</b> · 🧪 Devnet",
        "",
        "Your wallets on the bot. Tap one to see its address, withdraw or rename it.",
        "",
        "1. Main",
        "   └ 7xKX…gAsU · 2.500 SOL ($258.40)",
        "2. Test",
        "   └ 3pLm…Aa81 · 1.750 SOL ($180.88)",
        "",
        "Total: 4.250 SOL ($439.28)",
        "🕒 Updated 14:32 UTC",
      ].join("\n"),
    );
  });

  it("hides every USD amount without a SOL price", () => {
    const text = listText(list({ solUsd: null }));

    expect(text).not.toContain("$");
    expect(text).toContain("└ 7xKX…gAsU · 2.500 SOL\n");
    expect(text).toContain("Total: 4.250 SOL\n");
  });

  it("replaces the list by an invitation when there is no wallet", () => {
    const text = listText(list({ wallets: [], totalLamports: 0n, count: 0 }));

    expect(text).toContain("<b>👛 WALLETS · 0/5</b>");
    expect(text.endsWith("\n\nNo wallet yet. Create or import one to get started.")).toBe(true);
    expect(text).not.toContain("Total");
    expect(text).not.toContain("Updated");
    expect(keyboardOf(buildWalletListScreen(ui, list({ wallets: [], count: 0 })))).toEqual([
      [
        { text: "➕ Create", callback_data: "wal:new" },
        { text: "📥 Import", callback_data: "wal:imp" },
      ],
      [
        { text: "🔄 Refresh", callback_data: "wal:lref" },
        { text: "⬅️ Back", callback_data: "nav:home" },
      ],
    ]);
  });

  it.each([
    [5, 5, "5/5 · limit reached"],
    [7, 5, "7/5 · limit reached"],
    [2, 3, "2/3"],
  ])("counts %i/%i in the header: %s", (count, limit, counter) => {
    expect(listText(list({ count, limit }))).toContain(`<b>👛 WALLETS · ${counter}</b>`);
  });

  it("says when the balances could not be read", () => {
    const unavailable = list({
      wallets: TEST_BALANCES.wallets.map((wallet) => ({ ...wallet, lamports: null })),
      totalLamports: null,
      status: "unavailable",
    });

    const text = listText(unavailable);

    expect(text).toContain("└ 7xKX…gAsU · — SOL");
    expect(text).toContain("Total: — SOL");
    expect(text.endsWith("\n\n⚠️ Balances unavailable right now. Tap Refresh to try again.")).toBe(
      true,
    );
  });

  it("writes the flag of a blocked click after the list, and a notice last", () => {
    expect(
      listText(list(), en.wallets.limitReached.flag).endsWith(
        "🕒 Updated 14:32 UTC\n\n⚠️ Wallet limit reached. Upgrade to get more.",
      ),
    ).toBe(true);
    expect(
      buildWalletListScreen(ui, list(), { notice: en.wallets.delete.done }).text.endsWith(
        "\n\n✅ Wallet deleted.",
      ),
    ).toBe(true);
  });

  it("escapes the name in the text, not in the button", () => {
    const screen = buildWalletListScreen(ui, list({ wallets: [{ ...MAIN, name: "<b>x</b>" }] }));

    expect(screen.text).toContain("1. &lt;b&gt;x&lt;/b&gt;");
    expect(keyboardOf(screen)[0]).toEqual([{ text: "👛 <b>x</b>", callback_data: "wal:v:w1" }]);
  });

  it("puts one button per wallet, in order, above Create / Import and Refresh / Back", () => {
    const keyboard = keyboardOf(buildWalletListScreen(ui, list()));

    expect(keyboard.map((row) => row.length)).toEqual([1, 1, 2, 2]);
    expect(keyboard[1]).toEqual([{ text: "👛 Test", callback_data: "wal:v:w2" }]);
  });
});

describe("buildWalletDetailScreen", () => {
  it("renders the mockup of §9.2 with the notice of a creation", () => {
    expect(buildWalletDetailScreen(ui, detail(), { notice: en.wallets.created }).text).toBe(
      [
        "<b>👛 Main</b> · 🧪 Devnet",
        "",
        "Tap the address to copy it.",
        "",
        "<code>7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU</code>",
        "",
        "💰 2.500 SOL ($258.40)",
        "📅 Created 12 Sep 2026",
        "🕒 Updated 14:32 UTC",
        "",
        "✅ Wallet created. Send SOL to this address to fund it.",
      ].join("\n"),
    );
  });

  it("shows the balance without USD when the price is unknown, and a flag when unread", () => {
    expect(buildWalletDetailScreen(ui, { ...detail(), solUsd: null }).text).toContain(
      "💰 2.500 SOL\n",
    );
    expect(buildWalletDetailScreen(ui, detail({ lamports: null })).text).toContain(
      "💰 — SOL\n📅 Created 12 Sep 2026\n🕒 Updated 14:32 UTC\n\n⚠️ Balance unavailable right now. Tap Refresh to try again.",
    );
  });

  it("escapes the name of the header", () => {
    expect(buildWalletDetailScreen(ui, detail({ name: "<b>x</b>" })).text).toContain(
      "<b>👛 &lt;b&gt;x&lt;/b&gt;</b> · 🧪 Devnet",
    );
  });

  it("lays the keyboard out as the mockup, with the explorer on devnet", () => {
    expect(keyboardOf(buildWalletDetailScreen(ui, detail({ id: UUID })))).toEqual([
      [{ text: "📤 Withdraw", callback_data: `wal:wd:${UUID}` }],
      [
        { text: "✏️ Rename", callback_data: `wal:ren:${UUID}` },
        { text: "🗑 Delete", callback_data: `wal:del:${UUID}` },
      ],
      [
        {
          text: "🔍 Explorer",
          url: "https://explorer.solana.com/address/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU?cluster=devnet",
        },
        { text: "🔄 Refresh", callback_data: `wal:ref:${UUID}` },
      ],
      [{ text: "⬅️ Back", callback_data: "wal:list" }],
    ]);
  });

  it("keeps every callback within 64 bytes with a uuid", () => {
    for (const build of [
      WALLET_CB.view,
      WALLET_CB.refresh,
      WALLET_CB.withdraw,
      WALLET_CB.rename,
      WALLET_CB.delete,
      WALLET_CB.confirmDelete,
      WALLET_CB.withdrawAll,
    ]) {
      expect(isCallbackDataSize(build(UUID))).toBe(true);
    }
    expect(MENU.wallets).toBe(WALLET_CB.list);
  });
});

describe("provisional screens", () => {
  it("shows the wallet line and goes back to the detail", () => {
    const screen = buildWithdrawSoonScreen(ui, detail());

    expect(screen.text).toBe(
      [
        "<b>📤 WITHDRAW</b> · 🧪 Devnet",
        "",
        "Withdrawals are coming soon.",
        "",
        "👛 Main · 2.500 SOL ($258.40)",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([[{ text: "⬅️ Back", callback_data: "wal:v:w1" }]]);
  });

  it("goes back to the list from the import screen", () => {
    const screen = buildImportSoonScreen(ui);

    expect(screen.text).toContain(
      "<b>📥 IMPORT WALLET</b> · 🧪 Devnet\n\nWallet import is coming soon.",
    );
    expect(keyboardOf(screen)).toEqual([[{ text: "⬅️ Back", callback_data: "wal:list" }]]);
  });
});

describe("wallet handlers", () => {
  it("opens the list from the menu button, by editing the screen", async () => {
    const { bot, api } = botHarness();

    await feed(bot, callbackUpdate(MENU.wallets));

    expect(api.of("sendMessage")).toEqual([]);
    expect(api.text("editMessageText")).toContain("<b>👛 WALLETS · 2/3</b> · 🧪 Devnet");
    expect(api.text("editMessageText")).toContain("1. Main");
  });

  it("opens the detail of a wallet of the user", async () => {
    const { bot, api } = botHarness();

    await feed(bot, callbackUpdate(WALLET_CB.view("w2")));

    expect(api.text("editMessageText")).toContain("<b>👛 Test</b> · 🧪 Devnet");
    expect(api.text("editMessageText")).toContain(`<code>${TEST.publicKey}</code>`);
  });

  it("creates a wallet and opens its detail with the notice, nothing else", async () => {
    const create = vi.fn<WalletService["create"]>(() =>
      Promise.resolve({ ok: true, wallet: { ...TEST, publicKey: "x" } }),
    );
    const { bot, api } = botHarness({ wallets: { create } });

    await feed(bot, callbackUpdate(WALLET_CB.create));

    expect(create).toHaveBeenCalledExactlyOnceWith(TEST_USER.id);
    const text = api.text("editMessageText");
    expect(text).toContain("<b>👛 Test</b>");
    expect(text).toContain("✅ Wallet created. Send SOL to this address to fund it.");
    expect(api.of("answerCallbackQuery")[0]?.payload["show_alert"]).toBeUndefined();
  });

  it("blocks a Create at the limit with the alert and the flag on the list", async () => {
    const { bot, api } = botHarness({
      wallets: { create: () => Promise.resolve({ ok: false, reason: "limit_reached" }) },
    });

    await feed(bot, callbackUpdate(WALLET_CB.create));

    expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "Wallet limit reached. Upgrade to get more.",
      show_alert: true,
    });
    const text = api.text("editMessageText");
    expect(text).toContain("<b>👛 WALLETS · 2/3</b>");
    expect(text).toContain("⚠️ Wallet limit reached. Upgrade to get more.");
  });

  it.each([
    ["the detail", WALLET_CB.view],
    ["a Refresh", WALLET_CB.refresh],
    ["a provisional screen", WALLET_CB.withdraw],
  ])(
    "falls back to the list with a flag when %s targets a wallet that is gone",
    async (_label, build) => {
      const { bot, api } = botHarness();

      await feed(bot, callbackUpdate(build("gone")));

      expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
        text: "This wallet no longer exists.",
        show_alert: true,
      });
      expect(api.text("editMessageText")).toContain("⚠️ This wallet no longer exists.");
      expect(api.text("editMessageText")).toContain("<b>👛 WALLETS");
    },
  );

  it("reads fresh balances on the first Refresh only, within 10 s", async () => {
    const listWithBalances = vi.fn<WalletService["listWithBalances"]>(() =>
      Promise.resolve({ ...TEST_BALANCES, count: 2, limit: 3 } satisfies WalletListData),
    );
    const { bot } = botHarness({ wallets: { listWithBalances } });

    await feed(bot, callbackUpdate(WALLET_CB.refreshList));
    await feed(bot, callbackUpdate(WALLET_CB.refreshList));

    expect(listWithBalances.mock.calls.map(([, options]) => options?.skipCache)).toEqual([
      true,
      false,
    ]);
  });

  it("answers Already up to date when the refreshed screen is identical", async () => {
    const { bot, api } = botHarness({
      replies: {
        editMessageText: telegramError("editMessageText", "Bad Request: message is not modified"),
      },
    });

    await feed(bot, callbackUpdate(WALLET_CB.refresh("w1")));

    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBe(en.common.alreadyUpToDate);
  });

  it.each([
    ["withdraw", WALLET_CB.withdraw("w1"), "Withdrawals are coming soon."],
    ["withdraw all", WALLET_CB.withdrawAll("w1"), "Withdrawals are coming soon."],
    ["import", WALLET_CB.import, "Wallet import is coming soon."],
  ])("shows the provisional screen of %s", async (_label, data, text) => {
    const { bot, api } = botHarness();

    await feed(bot, callbackUpdate(data));

    expect(api.text("editMessageText")).toContain(text);
  });
});

describe("rename screens (V1-11)", () => {
  it("asks for the name with the current one and the rule", () => {
    expect(buildRenameScreen(ui, MAIN).text).toBe(
      [
        "<b>✏️ RENAME WALLET</b> · 🧪 Devnet",
        "",
        "Send the new name.",
        "",
        "Current: Main",
        "1 to 32 characters, different from your other wallets.",
      ].join("\n"),
    );
    expect(keyboardOf(buildRenameScreen(ui, MAIN))).toEqual([
      [{ text: "❌ Cancel", callback_data: "wal:v:w1" }],
    ]);
  });

  it("keeps the input open with the error under the rules", () => {
    const text = buildRenameScreen(ui, MAIN, { flag: en.wallets.rename.errors.empty }).text;

    expect(text.endsWith("your other wallets.\n\n⚠️ The name can't be empty.")).toBe(true);
  });
});

describe("delete screens (V1-11)", () => {
  it("asks for a confirmation with the text of the context, name escaped", () => {
    const screen = buildDeleteConfirmScreen(ui, { ...MAIN, name: "<b>x</b>" });

    expect(screen.text).toBe(
      [
        "<b>🗑 DELETE WALLET</b> · 🧪 Devnet",
        "",
        'Delete wallet "&lt;b&gt;x&lt;/b&gt;" (7xKX…gAsU)?',
        "Its encrypted key will be erased. This cannot be undone.",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "✅ Yes, delete", callback_data: "wal:delok:w1" },
        { text: "❌ Cancel", callback_data: "wal:v:w1" },
      ],
    ]);
  });

  it("blocks with the balance, with and without USD, and says < 0.001 SOL for dust", () => {
    const blocked = (lamports: bigint, solUsd: number | null) =>
      buildDeleteBlockedScreen(ui, MAIN, lamports, solUsd);

    expect(blocked(2_500_000_000n, 103.36).text).toBe(
      [
        "<b>🗑 DELETE WALLET</b> · 🧪 Devnet",
        "",
        "⚠️ Main still holds 2.500 SOL ($258.40). Withdraw it before deleting: a deleted wallet can't be recovered.",
      ].join("\n"),
    );
    expect(blocked(2_500_000_000n, null).text).toContain("still holds 2.500 SOL. Withdraw");
    expect(blocked(500_000n, 103.36).text).toContain("still holds &lt; 0.001 SOL. Withdraw");
    expect(keyboardOf(blocked(1n, null))).toEqual([
      [{ text: "📤 Withdraw all", callback_data: "wal:wdall:w1" }],
      [{ text: "⬅️ Back", callback_data: "wal:v:w1" }],
    ]);
  });
});

describe("rename handlers (V1-11)", () => {
  const SCREEN_ID = 50;
  const PENDING = { kind: "wallet_rename", walletId: "w1" };
  const openRename = (bot: Parameters<typeof feed>[0]) =>
    feed(bot, callbackUpdate(WALLET_CB.rename("w1"), { messageId: SCREEN_ID }));

  it("opens the input and remembers it in the session", async () => {
    const { bot, api, prisma } = botHarness();

    await openRename(bot);

    expect(api.text("editMessageText")).toContain("Send the new name.");
    expect(storedSession(prisma)?.pendingInput).toEqual(PENDING);
  });

  it("renames on the next text, deletes it, and edits the screen in place", async () => {
    const rename = vi.fn<WalletService["rename"]>((_userId, _walletId, name) =>
      Promise.resolve({ ok: true, wallet: { ...MAIN, name } }),
    );
    const { bot, api, prisma } = botHarness({ wallets: { rename } });
    await openRename(bot);

    await feed(bot, textUpdate("Trading"));

    expect(rename).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, "w1", "Trading");
    expect(api.of("deleteMessage")).toHaveLength(1);
    const edit = api.of("editMessageText")[1]?.payload;
    expect(edit).toMatchObject({ message_id: SCREEN_ID });
    expect(String(edit?.["text"])).toContain("✅ Wallet renamed.");
    expect(api.of("sendMessage")).toEqual([]);
    expect(storedSession(prisma)?.pendingInput).toBeUndefined();
  });

  it.each<[string, Awaited<ReturnType<WalletService["rename"]>>, string]>([
    [
      "an empty name",
      { ok: false, issue: { reason: "empty" }, wallet: MAIN },
      "⚠️ The name can't be empty.",
    ],
    [
      "a name too long",
      { ok: false, issue: { reason: "too_long", length: 41 }, wallet: MAIN },
      "⚠️ Too long: 41 characters (32 max).",
    ],
    [
      "a line break",
      { ok: false, issue: { reason: "invalid" }, wallet: MAIN },
      "⚠️ Send the name on one line.",
    ],
    [
      "a duplicate",
      { ok: false, issue: { reason: "duplicate", name: "<Test>" }, wallet: MAIN },
      '⚠️ You already have a wallet named "&lt;Test&gt;".',
    ],
  ])("keeps the input open after %s, with the flag", async (_label, result, flag) => {
    const { bot, api, prisma } = botHarness({ wallets: { rename: () => Promise.resolve(result) } });
    await openRename(bot);

    await feed(bot, textUpdate("whatever"));

    const text = api.text("editMessageText", 1);
    expect(text).toContain("Current: Main");
    expect(text.endsWith(flag)).toBe(true);
    expect(storedSession(prisma)?.pendingInput).toEqual(PENDING);
  });

  it("asks for a text message when a photo arrives", async () => {
    const { bot, api } = botHarness();
    await openRename(bot);

    await feed(bot, photoUpdate());

    expect(api.text("editMessageText", 1)).toContain("⚠️ Send the name as a text message.");
  });

  it("falls back to the list when the wallet was deleted meanwhile", async () => {
    const { bot, api, prisma } = botHarness({
      wallets: { rename: () => Promise.resolve({ ok: false, issue: { reason: "not_found" } }) },
    });
    await openRename(bot);

    await feed(bot, textUpdate("Trading"));

    expect(api.text("editMessageText", 1)).toContain("⚠️ This wallet no longer exists.");
    expect(storedSession(prisma)?.pendingInput).toBeUndefined();
  });

  it.each([
    ["a click that shows another screen", () => callbackUpdate(WALLET_CB.list)],
    ["a command", () => textUpdate("/start")],
  ])("abandons the input on %s: the next text renames nothing", async (_label, update) => {
    const rename = vi.fn<WalletService["rename"]>();
    const { bot, api, prisma } = botHarness({ wallets: { rename } });
    await openRename(bot);

    await feed(bot, update());
    expect(storedSession(prisma)?.pendingInput).toBeUndefined();
    const before = api.calls.length;
    await feed(bot, textUpdate("Trading"));

    expect(rename).not.toHaveBeenCalled();
    expect(api.calls).toHaveLength(before);
  });

  it("keeps the input through a click that only answers a toast", async () => {
    const { bot, prisma } = botHarness();
    await openRename(bot);

    await feed(bot, callbackUpdate("zzz:stale"));

    expect(storedSession(prisma)?.pendingInput).toEqual(PENDING);
  });
});

describe("delete handlers (V1-11)", () => {
  const detailOf = (wallet: WalletDetailData["wallet"]): WalletDetailData => ({
    wallet,
    fetchedAt: TEST_BALANCES.fetchedAt,
    status: "fresh",
  });

  it("asks for a confirmation for a wallet that holds nothing", async () => {
    const { bot, api } = botHarness();

    await feed(bot, callbackUpdate(WALLET_CB.delete("w2")));

    expect(api.text("editMessageText")).toContain('Delete wallet "Test" (3pLm…Aa81)?');
  });

  it("blocks a wallet that still holds SOL, and opens the withdrawal from there", async () => {
    const { bot, api } = botHarness();

    await feed(bot, callbackUpdate(WALLET_CB.delete("w1")));

    expect(api.text("editMessageText")).toContain("⚠️ Main still holds 2.500 SOL");
    expect(api.keyboard("editMessageText")[0]).toEqual([
      { text: "📤 Withdraw all", callback_data: "wal:wdall:w1" },
    ]);
  });

  it("deletes on Yes, delete and shows the list with the notice", async () => {
    const remove = vi.fn<WalletService["delete"]>(() => Promise.resolve({ status: "deleted" }));
    const { bot, api } = botHarness({ wallets: { delete: remove } });

    await feed(bot, callbackUpdate(WALLET_CB.confirmDelete("w2")));

    expect(remove).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, "w2");
    const text = api.text("editMessageText");
    expect(text).toContain("<b>👛 WALLETS");
    expect(text.endsWith("✅ Wallet deleted.")).toBe(true);
  });

  it("blocks Yes, delete when SOL arrived since the confirmation", async () => {
    const { bot, api } = botHarness({
      wallets: {
        delete: () =>
          Promise.resolve({
            status: "blocked_balance",
            detail: detailOf(TEST),
            lamports: 2_000_000_000n,
          }),
      },
    });

    await feed(bot, callbackUpdate(WALLET_CB.confirmDelete("w2")));

    expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "This wallet received SOL. Withdraw it first.",
      show_alert: true,
    });
    expect(api.text("editMessageText")).toContain("⚠️ Test still holds 2.000 SOL");
  });

  it.each<[string, Awaited<ReturnType<WalletService["checkDeletable"]>>, string, string]>([
    [
      "the balance could not be read",
      { status: "balance_unavailable", detail: detailOf(MAIN) },
      "Couldn't check the balance. Try again in a moment.",
      "⚠️ Couldn't check the balance. Try again in a moment.",
    ],
    [
      "a withdrawal is pending",
      { status: "blocked_pending_withdrawal", detail: detailOf({ ...MAIN, name: "<M>" }) },
      "A withdrawal from this wallet is still pending. Try again in a moment.",
      "⚠️ A withdrawal from this wallet is still pending. Try again in a moment.",
    ],
  ])(
    "refuses with the alert and the flag on the detail when %s, without reading again",
    async (_label, check, alert, flag) => {
      const getOwned = vi.fn<WalletService["getOwned"]>();
      const { bot, api } = botHarness({
        wallets: { checkDeletable: () => Promise.resolve(check), getOwned },
      });

      await feed(bot, callbackUpdate(WALLET_CB.delete("w1")));

      expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
        text: alert,
        show_alert: true,
      });
      const text = api.text("editMessageText");
      expect(text).toContain("<b>👛 ");
      expect(text).toContain(flag);
      expect(getOwned).not.toHaveBeenCalled();
    },
  );

  it("falls back to the list for a wallet that is gone, on Delete and on Yes, delete", async () => {
    const { bot, api } = botHarness();

    await feed(bot, callbackUpdate(WALLET_CB.delete("gone")));
    await feed(bot, callbackUpdate(WALLET_CB.confirmDelete("gone")));

    expect(api.of("editMessageText").map((call) => String(call.payload["text"]))).toEqual(
      expect.arrayContaining([expect.stringContaining("⚠️ This wallet no longer exists.")]),
    );
    expect(api.of("editMessageText")).toHaveLength(2);
  });
});
