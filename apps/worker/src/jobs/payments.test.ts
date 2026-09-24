import type { InvoiceCheck, InvoiceRow, PaidNotice, PaymentService } from "@launchbot/db";
import { createUi } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SendResult, TelegramSender } from "../telegram.js";
import { detectPayments, notifyPaid } from "./payments.js";

const NOW = new Date("2026-09-17T14:32:00Z");
const END = new Date("2026-09-19T14:32:00Z");

afterEach(() => {
  setLogDestination(undefined);
});

/** What `detectPayments` reads of a check: its kind, and who activated. */
const check = (kind: InvoiceCheck["kind"], activatedNow = false): InvoiceCheck =>
  ({ kind, activatedNow, plan: "PREMIUM", expiresAt: END, checkedAt: NOW }) as InvoiceCheck;

const rows = (...ids: string[]) => ids.map((id) => ({ id }) as InvoiceRow);

/** Only the three methods of V1-28 the loop may call: anything else would be undefined. */
function fakePayments(checks: [string, InvoiceCheck][], expired = 0) {
  return {
    listInvoicesToCheck: vi.fn(() => Promise.resolve(rows(...checks.map(([id]) => id)))),
    checkInvoicesBatch: vi.fn(() => Promise.resolve(new Map(checks))),
    expireDueInvoices: vi.fn(() => Promise.resolve(expired)),
  } satisfies Pick<
    PaymentService,
    "listInvoicesToCheck" | "checkInvoicesBatch" | "expireDueInvoices"
  >;
}

describe("detectPayments (V1-32)", () => {
  it("checks every invoice in one batch, then expires, and reports the tick", async () => {
    const payments = fakePayments(
      [
        ["paid", check("ACTIVATED", true)],
        ["half", check("PARTIAL")],
        ["none", check("NOT_DETECTED")],
      ],
      2,
    );

    const report = await detectPayments({
      payments,
      afterActivation: [],
      now: () => NOW,
    });

    expect(report).toEqual({ checked: 3, activated: 1, partial: 1, expired: 2 });
    expect(payments.checkInvoicesBatch).toHaveBeenCalledWith(rows("paid", "half", "none"), NOW);
    // After the checks: a payment of 29:59 activates rather than expires.
    expect(payments.expireDueInvoices.mock.invocationCallOrder[0]).toBeGreaterThan(
      payments.checkInvoicesBatch.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("tells only what the worker itself activated, then moves its funds, in order", async () => {
    const order: string[] = [];
    const payments = fakePayments([
      ["mine", check("ACTIVATED", true)],
      ["bot", check("ACTIVATED", false)],
      ["late", check("LATE_FULL_PAYMENT")],
    ]);

    await detectPayments({
      payments,
      afterActivation: [
        (id) => Promise.resolve(void order.push(`notify:${id}`)),
        (id) => Promise.resolve(void order.push(`sweep:${id}`)),
      ],
      now: () => NOW,
    });

    expect(order).toEqual(["notify:mine", "sweep:mine"]);
  });

  it("keeps an activation whose message or transfer fails, and goes on with the rest", async () => {
    const lines = captureLogs();
    const payments = fakePayments([
      ["first", check("ACTIVATED", true)],
      ["second", check("ACTIVATED", true)],
    ]);
    const hook = vi.fn(() => Promise.resolve());

    const report = await detectPayments({
      payments,
      afterActivation: [
        vi.fn().mockRejectedValueOnce(new Error("queue down")).mockResolvedValue(null),
        hook,
      ],
      now: () => NOW,
    });

    expect(report.activated).toBe(2);
    expect(hook).toHaveBeenCalledTimes(2);
    expect(lines.join("")).toContain("payment.after_activation_failed");
  });

  it("still expires when the balances could not be read (an empty batch)", async () => {
    const payments = fakePayments([], 1);
    payments.listInvoicesToCheck.mockResolvedValue(rows("unread"));

    const report = await detectPayments({
      payments,
      afterActivation: [],
      now: () => NOW,
    });

    expect(report).toEqual({ checked: 0, activated: 0, partial: 0, expired: 1 });
  });

  it("never checks an invoice by itself, only the batch (one read per 100)", async () => {
    const payments = { ...fakePayments([]), checkInvoice: vi.fn() };

    await detectPayments({ payments, afterActivation: [], now: () => NOW });

    expect(payments.checkInvoicesBatch).toHaveBeenCalledWith([], NOW);
    expect(payments.checkInvoice).not.toHaveBeenCalled();
    expect(payments.expireDueInvoices).toHaveBeenCalledOnce();
  });
});

describe("notifyPaid (V1-32)", () => {
  const ui = createUi("devnet");
  const notice: PaidNotice = { telegramId: 123_456_789n, plan: "PREMIUM", expiresAt: END };

  const deps = (found: PaidNotice | null, result: SendResult) => {
    const sendScreen = vi.fn<TelegramSender["sendScreen"]>(() => Promise.resolve(result));
    return {
      sendScreen,
      deps: {
        payments: { getPaidNotice: vi.fn(() => Promise.resolve(found)) },
        telegram: { sendScreen },
        ui,
        now: () => NOW,
      },
    };
  };

  it("sends « Payment received » with the plan and its end as they stand", async () => {
    const { deps: d, sendScreen } = deps(notice, { ok: true, messageId: 1 });

    await notifyPaid(d, "pay_1");

    const [telegramId, screen] = sendScreen.mock.calls[0] ?? [];
    expect(telegramId).toBe(123_456_789n);
    expect(screen?.text).toContain(
      "✅ Payment received. Premium is active until 19 Sep 2026, 14:32 UTC.",
    );
    expect(screen?.reply_markup.inline_keyboard).toEqual([
      [
        { text: "🚀 Launch Coin", callback_data: "lc:open" },
        { text: "🏠 Menu", callback_data: "nav:home" },
      ],
    ]);
  });

  it("sends nothing for a purged account or a plan over already", async () => {
    captureLogs();
    const { deps: d, sendScreen } = deps(null, { ok: true, messageId: 1 });

    await notifyPaid(d, "pay_1");

    expect(sendScreen).not.toHaveBeenCalled();
  });

  it.each(["BLOCKED", "CHAT_NOT_FOUND"] as const)("does not retry %s", async (reason) => {
    await expect(
      notifyPaid(deps(notice, { ok: false, reason }).deps, "p"),
    ).resolves.toBeUndefined();
  });

  it.each(["ERROR", "RATE_LIMITED"] as const)("throws on %s for a retry", async (reason) => {
    await expect(notifyPaid(deps(notice, { ok: false, reason }).deps, "p")).rejects.toThrow(reason);
  });
});
