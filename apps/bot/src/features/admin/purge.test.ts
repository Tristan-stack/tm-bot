import type { AccountDeletionService, DeleteUserResult, PurgeSummary, User } from "@launchbot/db";
import { createUi, DAY_MS } from "@launchbot/shared";
import { captureLogs, resetRateLimits, setLogDestination } from "@launchbot/shared/server";
import { GrammyError } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  botHarness,
  buttonTexts,
  callbackUpdate,
  feed,
  MAIN_WALLET,
  TEST_USER,
  TEST_WALLET,
  textUpdate,
} from "../../test-harness.js";
import type { ApiReplies } from "../../test-harness.js";
import type { DataServices } from "../../services/data.js";
import { buildPurgeResultScreen, buildPurgeSummaryScreen } from "./purge-screens.js";

const ui = createUi("devnet");
const NOW = new Date("2026-09-15T14:32:00Z");
const TARGET: User = {
  ...TEST_USER,
  id: "cjld2cjxh0000qzrmn831target",
  telegramId: 555_000_111n,
  username: "username",
};

beforeEach(resetRateLimits);
afterEach(() => {
  setLogDestination(undefined);
});

const summary = (overrides: Partial<PurgeSummary> = {}): PurgeSummary => ({
  user: TARGET,
  plan: { kind: "NONE" },
  wallets: [
    { ...MAIN_WALLET, lamports: 0n },
    { ...TEST_WALLET, lamports: 0n },
  ],
  invoices: [],
  blockers: [],
  ...overrides,
});

const PENDING_INVOICE = {
  paymentId: "p1",
  plan: "PREMIUM" as const,
  duration: "TWO_DAYS" as const,
  expectedLamports: 570_820_434n,
  status: "PENDING" as const,
  expiresAt: new Date("2026-09-15T14:52:00Z"),
  payableUntil: new Date("2026-09-16T14:52:00Z"),
};

describe("buildPurgeSummaryScreen (V1-44)", () => {
  it("blocked: the funds and the invoice said, Cancel only", () => {
    const screen = buildPurgeSummaryScreen(ui, {
      now: NOW,
      summary: summary({
        plan: {
          kind: "ACTIVE",
          subscription: {
            plan: "PREMIUM",
            duration: "ONE_MONTH",
            startsAt: NOW,
            expiresAt: new Date("2026-10-12T14:32:00Z"),
          },
        },
        wallets: [
          { ...MAIN_WALLET, lamports: 2_500_000_000n },
          { ...TEST_WALLET, lamports: 0n },
        ],
        invoices: [PENDING_INVOICE],
        blockers: [
          { kind: "WALLET_FUNDS", walletId: "w1", name: "Main", lamports: 2_500_000_000n },
          { kind: "PENDING_INVOICE", ...PENDING_INVOICE },
        ],
      }),
    });

    expect(screen.text).toBe(
      [
        "<b>🗑 PURGE USER</b> · 🧪 Devnet",
        "",
        "Delete all data of this user. Wallet keys will be erased: funds left on them can't be recovered.",
        "",
        "<b>👤 USER</b>",
        "┌ @username",
        "├ 🆔 <code>555000111</code>",
        "└ ⭐ Premium · until 12 Oct",
        "",
        "<b>👛 WALLETS</b>",
        "┌ Main · 7xKX…gAsU · 2.500 SOL",
        "└ Test · 3pLm…Aa81 · 0.000 SOL",
        "",
        "<b>🧾 PENDING INVOICES</b>",
        "└ Premium · 2 days · 0.5709 SOL · expires 14:52 UTC",
        "",
        "⚠️ Main still holds 2.500 SOL. Ask the user to withdraw first.",
        "⚠️ Invoice Premium · 2 days is still pending. Try again after it expires and its 24 h payment window ends.",
        "⚠️ The active subscription will be lost.",
      ].join("\n"),
    );
    expect(buttonTexts(screen.reply_markup)).toEqual([["❌ Cancel"]]);
  });

  it("an invoice ended but still payable, the balances unreadable", () => {
    const late = { ...PENDING_INVOICE, status: "EXPIRED" as const };
    const text = buildPurgeSummaryScreen(ui, {
      now: NOW,
      summary: summary({
        wallets: [{ ...MAIN_WALLET, lamports: null }],
        invoices: [late],
        blockers: [{ kind: "BALANCES_UNAVAILABLE" }, { kind: "PENDING_INVOICE", ...late }],
      }),
    }).text;

    expect(text).toContain("└ Main · 7xKX…gAsU · — SOL");
    expect(text).toContain(
      "└ Premium · 2 days · 0.5709 SOL · payable until 16 Sep 2026, 14:52 UTC",
    );
    expect(text).toContain("⚠️ Balances unavailable. Try again later.");
    expect(text).toContain(
      "⚠️ Invoice Premium · 2 days can still be paid until 16 Sep 2026, 14:52 UTC. Try again after that.",
    );
  });

  it("nothing blocks: Confirm purge and Cancel, the id in the button", () => {
    const screen = buildPurgeSummaryScreen(ui, { now: NOW, summary: summary({ wallets: [] }) });

    expect(screen.text).toContain("<b>👛 WALLETS</b>\n└ No wallet");
    expect(screen.text).toContain("<b>🧾 PENDING INVOICES</b>\n└ None");
    expect(screen.text).toContain("└ ⭐ No subscription");
    expect(screen.reply_markup.inline_keyboard).toEqual([
      [
        { text: "🗑 Confirm purge", callback_data: "adm:prg:ok:555000111" },
        { text: "❌ Cancel", callback_data: "adm:prg:no" },
      ],
    ]);
  });
});

describe("buildPurgeResultScreen (V1-44)", () => {
  it("what went and what stays detached, then Menu", () => {
    const screen = buildPurgeResultScreen(ui, {
      counts: {
        wallets: 2,
        drafts: 4,
        simulations: 3,
        aiGenerations: 12,
        subscriptions: 1,
        payments: 2,
        withdrawals: 1,
      },
      notified: false,
    });

    expect(screen.text).toBe(
      [
        "<b>🗑 PURGE USER</b> · 🧪 Devnet",
        "",
        "✅ User data deleted. Payment records kept for accounting, detached from the account.",
        "",
        "Deleted: 2 wallets, 4 drafts, 3 simulations, 12 AI generations, 1 subscription.",
        "Detached: 2 payments, 1 withdrawal.",
        "",
        "ℹ️ The user could not be notified.",
      ].join("\n"),
    );
    expect(buttonTexts(screen.reply_markup)).toEqual([["🏠 Menu"]]);
  });
});

describe("/purge (V1-44)", () => {
  const DELETED: DeleteUserResult = {
    status: "DELETED",
    counts: {
      wallets: 2,
      drafts: 1,
      simulations: 1,
      aiGenerations: 0,
      subscriptions: 1,
      payments: 1,
      withdrawals: 0,
    },
  };

  function harness(
    options: {
      summaries?: (PurgeSummary | null)[];
      deleted?: () => Promise<DeleteUserResult>;
      replies?: ApiReplies;
    } = {},
  ) {
    const summaries = [...(options.summaries ?? [summary()])];
    const order: string[] = [];
    const getPurgeSummary = vi.fn<AccountDeletionService["getPurgeSummary"]>((telegramId) =>
      Promise.resolve(
        telegramId === TARGET.telegramId
          ? summaries.length > 1
            ? summaries.shift()!
            : summaries[0]!
          : null,
      ),
    );
    const deleteUserData = vi.fn<AccountDeletionService["deleteUserData"]>(() => {
      order.push("deleteUserData");
      return options.deleted?.() ?? Promise.resolve(DELETED);
    });
    const invalidateUserBalances = vi.fn<DataServices["invalidateUserBalances"]>();
    const h = botHarness({
      env: { ADMIN_TELEGRAM_IDS: [ADMIN_ID] },
      replies: options.replies,
      data: { invalidateUserBalances },
      admin: { deletion: { getPurgeSummary, deleteUserData } },
    });
    h.bot.api.config.use((prev, method, payload, signal) => {
      if (method === "sendMessage" && (payload as { chat_id?: unknown }).chat_id === "555000111") {
        order.push("tellUser");
      }
      return prev(method, payload, signal);
    });
    const click = (data: string) => feed(h.bot, callbackUpdate(data, { messageId: 60 }));
    return { ...h, getPurgeSummary, deleteUserData, invalidateUserBalances, order, click };
  }

  it("an unknown account is « User not found. »", async () => {
    const h = harness();

    await feed(h.bot, textUpdate("/purge 42"));

    expect(h.api.text("sendMessage")).toContain("❌ User not found.\nSearched: 42");
  });

  it("reads the account by the id of a support code, whatever its letter", async () => {
    const h = harness();

    await feed(h.bot, textUpdate(`/purge C-${TARGET.telegramId}`));

    expect(h.getPurgeSummary).toHaveBeenCalledWith(TARGET.telegramId);
    expect(h.api.text("sendMessage")).toContain("<b>🗑 PURGE USER</b>");
  });

  it("tells the user first, then deletes, then shows what went", async () => {
    const logs = captureLogs();
    const h = harness();

    await h.click(`adm:prg:ok:${TARGET.telegramId}`);

    expect(h.order).toEqual(["tellUser", "deleteUserData"]);
    const told = h.api.of("sendMessage").find((call) => call.payload["chat_id"] === "555000111");
    expect(told?.payload["text"]).toBe("Your data has been deleted.");
    expect(h.deleteUserData).toHaveBeenCalledWith(TARGET.id);
    expect(h.invalidateUserBalances).toHaveBeenCalledWith(TARGET.id);
    expect(h.api.screen()).toContain("✅ User data deleted.");
    expect(h.api.screen()).not.toContain("could not be notified");
    const done = logs.find((line) => line.includes("purge.done")) ?? "";
    expect(done).toContain(TARGET.id);
    expect(done).not.toContain("username");
  });

  it("purges a user who blocked the bot, and says they were not told", async () => {
    const h = harness({
      replies: {
        sendMessage: new GrammyError(
          "Call to 'sendMessage' failed!",
          { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" },
          "sendMessage",
          {},
        ),
      },
    });

    await h.click(`adm:prg:ok:${TARGET.telegramId}`);

    expect(h.deleteUserData).toHaveBeenCalledOnce();
    expect(h.api.screen()).toContain("ℹ️ The user could not be notified.");
  });

  it("deletes nothing when a blocker appeared since the summary", async () => {
    const h = harness({
      summaries: [
        summary({
          blockers: [
            { kind: "WALLET_FUNDS", walletId: "w1", name: "Main", lamports: 1_000_000_000n },
          ],
        }),
      ],
    });

    await h.click(`adm:prg:ok:${TARGET.telegramId}`);

    expect(h.deleteUserData).not.toHaveBeenCalled();
    expect(h.order).toEqual([]);
    expect(h.api.lastAlert()).toMatchObject({
      text: "The user's data changed. Check the summary again.",
      show_alert: true,
    });
    expect(h.api.screen()).toContain("⚠️ Main still holds 1.000 SOL.");
  });

  it("says a failed purge deleted nothing", async () => {
    captureLogs();
    const h = harness({ deleted: () => Promise.reject(new Error("database down")) });

    await h.click(`adm:prg:ok:${TARGET.telegramId}`);

    expect(h.api.screen()).toContain("❌ Purge failed. Nothing was deleted. Try again.");
    expect(buttonTexts({ inline_keyboard: h.api.keyboard("editMessageText", -1) })).toEqual([
      ["🏠 Menu"],
    ]);
    expect(h.invalidateUserBalances).not.toHaveBeenCalled();
  });

  it("an account gone since the summary is « User not found. », with Menu", async () => {
    const h = harness({ summaries: [null] });

    await h.click(`adm:prg:ok:${TARGET.telegramId}`);

    expect(h.deleteUserData).not.toHaveBeenCalled();
    expect(h.api.screen()).toContain("❌ User not found.");
    expect(buttonTexts({ inline_keyboard: h.api.keyboard("editMessageText", -1) })).toEqual([
      ["🏠 Menu"],
    ]);
  });

  it("Cancel deletes nothing and says so", async () => {
    const h = harness();

    await h.click("adm:prg:no");

    expect(h.getPurgeSummary).not.toHaveBeenCalled();
    expect(h.deleteUserData).not.toHaveBeenCalled();
    expect(h.api.screen()).toContain("❌ Purge canceled. Nothing was deleted.");
  });

  it("an active plan does not block", async () => {
    const h = harness({
      summaries: [
        summary({
          plan: {
            kind: "ACTIVE",
            subscription: {
              plan: "PREMIUM",
              duration: "ONE_MONTH",
              startsAt: NOW,
              expiresAt: new Date(Date.now() + DAY_MS),
            },
          },
        }),
      ],
    });

    await h.click(`adm:prg:ok:${TARGET.telegramId}`);

    expect(h.deleteUserData).toHaveBeenCalledOnce();
  });
});
