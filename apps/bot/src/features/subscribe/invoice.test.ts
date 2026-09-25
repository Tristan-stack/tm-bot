import type { InvoiceCheck } from "@launchbot/db";
import {
  buildPaymentReceivedScreen,
  computeExpectedLamports,
  createUi,
  getOffer,
  invoiceSol,
  isCallbackDataSize,
  parseSolToLamports,
} from "@launchbot/shared";
import { resetRateLimits } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activatedCheck,
  botHarness,
  callbackUpdate,
  feed,
  keyboardOf,
  TEST_DEPOSIT,
  TEST_EXPECTED,
  TEST_INVOICE_ID,
  TEST_PLAN_END,
  TEST_USER,
  telegramError,
  testInvoice,
} from "../../test-harness.js";
import { MENU } from "../home/screen.js";
import { buildInvoiceExpiredScreen, buildInvoiceScreen } from "./invoice-screens.js";
import type { InvoicePayments } from "./invoice.js";
import { SUB_CB } from "./screens.js";

const ui = createUi("devnet");
const CHECKED_AT = new Date("2026-09-24T14:32:00Z");

// Every click counts against the global limit of the user (V1-04).
beforeEach(resetRateLimits);

const HEADER = "<b>⭐ PREMIUM · 2 DAYS</b>";
const SEND = `Send exactly 0.5709 SOL ($59.00) to:\n<code>${TEST_DEPOSIT}</code>`;
const PARTIAL = testInvoice({ receivedLamports: 300_000_000n, remainingLamports: 270_820_434n });

describe("invoice screens (§8.3)", () => {
  it("asks for the exact amount, rounded up, with the time left at the render", () => {
    const screen = buildInvoiceScreen(ui, { invoice: testInvoice(), line: { kind: "WAITING" } });

    expect(screen.text).toBe(
      [HEADER, SEND, "⏳ Waiting for payment · expires in 30:00"].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [{ text: "👛 Pay from my wallet", callback_data: `sub:pw:open:${TEST_INVOICE_ID}` }],
      [
        { text: "✅ I've paid", callback_data: `sub:paid:${TEST_INVOICE_ID}` },
        { text: "❌ Cancel", callback_data: `sub:cancel:${TEST_INVOICE_ID}` },
      ],
    ]);
  });

  it("shows Classic 1 month at its own price", () => {
    const offer = getOffer("CLASSIC", "ONE_MONTH");
    const expected = computeExpectedLamports(offer.priceUsdCents, "103.36");
    const invoice = testInvoice({
      offer,
      priceUsd: "169.00",
      expectedLamports: expected,
      remainingLamports: expected,
      secondsLeft: 245,
    });

    const screen = buildInvoiceScreen(ui, { invoice, line: { kind: "WAITING" } });

    expect(screen.text).toBe(
      [
        "<b>⭐ CLASSIC · 1 MONTH</b>",
        `Send exactly ${invoiceSol(expected)} ($169.00) to:\n<code>${TEST_DEPOSIT}</code>`,
        "⏳ Waiting for payment · expires in 4:05",
      ].join("\n\n"),
    );
  });

  it("never asks for less than the lamports expected, nor a step more", () => {
    for (const cents of [4_900, 5_900, 16_900, 17_900]) {
      for (const rate of ["103.36", "87.12345678", "250"]) {
        const expected = computeExpectedLamports(cents, rate);
        const shown = parseSolToLamports(invoiceSol(expected).replace(" SOL", ""));
        expect(shown).not.toBeNull();
        expect(shown! >= expected && shown! < expected + 100_000n).toBe(true);
      }
    }
    expect(invoiceSol(TEST_EXPECTED)).toBe("0.5709 SOL");
  });

  it("after « I've paid »: the last check, then the time left", () => {
    const screen = buildInvoiceScreen(ui, {
      invoice: testInvoice({ secondsLeft: 1_660 }),
      line: { kind: "LAST_CHECK", at: CHECKED_AT },
    });

    expect(screen.text).toBe(
      [HEADER, SEND, "⏳ Waiting for payment · last check 14:32 UTC\nExpires in 27:40."].join(
        "\n\n",
      ),
    );
  });

  it("keeps the total, and says what is still to send under the status line", () => {
    const screen = buildInvoiceScreen(ui, {
      invoice: PARTIAL,
      line: { kind: "LAST_CHECK", at: CHECKED_AT },
    });

    expect(screen.text).toContain(SEND);
    expect(screen.text).toContain(
      "Expires in 30:00.\n⚠️ Partial payment: 0.3000 SOL received, 0.2709 SOL still to send.",
    );
  });

  it("after a payment from a bot wallet (V1-31)", () => {
    const screen = buildInvoiceScreen(ui, {
      invoice: testInvoice(),
      line: { kind: "PAYMENT_SENT" },
    });

    expect(screen.text).toBe(
      [HEADER, SEND, "⏳ Payment sent, waiting for confirmation…"].join("\n\n"),
    );
  });

  it.each([
    ["EXPIRED", testInvoice({ status: "EXPIRED" }), []],
    ["PARTIAL_EXPIRED", PARTIAL, ["⚠️ 0.3000 SOL received. Contact support for a refund."]],
    [
      "LATE_FULL_PAYMENT",
      testInvoice({ receivedLamports: TEST_EXPECTED }),
      ["⚠️ Payment received after the deadline. Contact support for a refund."],
    ],
  ] as const)("says the invoice expired (%s)", (end, invoice, flags) => {
    const screen = buildInvoiceExpiredScreen(ui, invoice, end);

    expect(screen.text).toBe(
      [
        HEADER,
        "⌛ Invoice expired.\nThe SOL amount was locked for 30 minutes. A new invoice uses the current SOL price.",
        ...flags,
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "🧾 New invoice", callback_data: `sub:new:${TEST_INVOICE_ID}` },
        { text: "⬅️ Back", callback_data: "sub:open" },
      ],
    ]);
  });

  it("says the payment was received, and until when", () => {
    const screen = buildPaymentReceivedScreen(ui, { plan: "PREMIUM", expiresAt: TEST_PLAN_END });

    expect(screen.text).toBe(
      [
        "<b>⭐ SUBSCRIBE</b>",
        "✅ Payment received. Premium is active until 26 Sep 2026, 12:05 UTC.",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "🚀 Launch Coin", callback_data: MENU.launchCoin },
        { text: "🏠 Menu", callback_data: "nav:home" },
      ],
    ]);
  });

  it("keeps the callback data within 64 bytes, with no key material", () => {
    const screen = buildInvoiceScreen(ui, { invoice: testInvoice(), line: { kind: "WAITING" } });
    const expired = buildInvoiceExpiredScreen(ui, testInvoice(), "EXPIRED");
    const data = [screen, expired].flatMap((built) =>
      built.reply_markup.inline_keyboard
        .flat()
        .map((button) => ("callback_data" in button ? String(button.callback_data) : "")),
    );

    for (const callback of [...data, SUB_CB.invoice(TEST_INVOICE_ID)]) {
      expect(isCallbackDataSize(callback)).toBe(true);
    }
    expect(screen.text).not.toMatch(/encSecretKey|authTag|iv:/);
  });
});

describe("invoice clicks (§8.3)", () => {
  const checkOf = (kind: InvoiceCheck["kind"], invoice = testInvoice()): InvoiceCheck =>
    kind === "ACTIVATED"
      ? activatedCheck(CHECKED_AT)
      : kind === "NOT_FOUND"
        ? { kind, checkedAt: CHECKED_AT }
        : { kind, invoice, checkedAt: CHECKED_AT };

  const harness = (payments: Partial<InvoicePayments> = {}, replies = {}) =>
    botHarness({ payments, replies });

  it("opens the invoice from an offer, in place", async () => {
    const createInvoice = vi.fn<InvoicePayments["createInvoice"]>(({ offer }) =>
      Promise.resolve({ ok: true, invoice: testInvoice({ offer }), reused: false }),
    );
    const h = harness({ createInvoice });

    await feed(h.bot, callbackUpdate(SUB_CB.buy("P2D"), { messageId: 55 }));

    expect(createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ userId: TEST_USER.id, offer: getOffer("PREMIUM", "TWO_DAYS") }),
    );
    expect(h.api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 55 });
    expect(h.api.screen()).toContain("⏳ Waiting for payment · expires in 30:00");
  });

  it.each([
    ["PRICE_UNAVAILABLE", "Payments are temporarily unavailable."],
    ["RATE_LIMITED", "Too many invoices. Try again in a few minutes."],
  ] as const)("refuses %s: alert, and the offers with the line", async (error, text) => {
    const h = harness({ createInvoice: () => Promise.resolve({ ok: false, error }) });

    await feed(h.bot, callbackUpdate(SUB_CB.buy("C2D")));

    expect(h.api.lastAlert()).toMatchObject({ text, show_alert: true });
    expect(h.api.screen()).toContain("<b>⭐ SUBSCRIBE</b>");
    expect(h.api.screen()).toContain(`⚠️ ${text}`);
  });

  it("refuses Classic during a Premium that started meanwhile", async () => {
    const h = harness({
      createInvoice: () => Promise.resolve({ ok: false, error: "PLAN_SWITCH_REFUSED" }),
    });

    await feed(h.bot, callbackUpdate(SUB_CB.buy("C2D")));

    expect(h.api.lastAlert()).toMatchObject({
      text: "You can switch to Classic when Premium expires.",
      show_alert: true,
    });
    expect(h.api.screen()).toContain("<b>⭐ SUBSCRIBE</b>");
  });

  describe("I've paid", () => {
    it("nothing yet: a toast, and the last check on the invoice", async () => {
      const h = harness({
        checkInvoice: () => Promise.resolve(checkOf("NOT_DETECTED")),
      });

      await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));

      expect(h.api.lastAlert()).toMatchObject({
        text: "Payment not detected yet. It can take up to a minute.",
        show_alert: false,
      });
      expect(h.api.screen()).toContain("⏳ Waiting for payment · last check 14:32 UTC");
    });

    it("a part: a toast, and the partial line", async () => {
      const h = harness({ checkInvoice: () => Promise.resolve(checkOf("PARTIAL", PARTIAL)) });

      await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));

      expect(h.api.lastAlert()).toMatchObject({ text: "Partial payment detected." });
      expect(h.api.screen()).toContain("⚠️ Partial payment: 0.3000 SOL received");
    });

    it.each([true, false])(
      "paid: « Payment received » whoever activated (activatedNow %s)",
      async (activatedNow) => {
        const h = harness({
          checkInvoice: () => Promise.resolve({ ...activatedCheck(CHECKED_AT), activatedNow }),
        });

        await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));

        expect(h.api.screen()).toContain("✅ Payment received. Premium is active until");
        expect(h.api.of("sendMessage")).toHaveLength(0);
      },
    );

    it.each([
      ["EXPIRED", undefined],
      ["PARTIAL_EXPIRED", "⚠️ 0.3000 SOL received. Contact support for a refund."],
      ["LATE_FULL_PAYMENT", "⚠️ Payment received after the deadline."],
    ] as const)("%s: the invoice expired", async (kind, flag) => {
      const h = harness({ checkInvoice: () => Promise.resolve(checkOf(kind, PARTIAL)) });

      await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));

      expect(h.api.screen()).toContain("⌛ Invoice expired.");
      if (flag !== undefined) expect(h.api.screen()).toContain(flag);
    });

    it("canceled: the offers", async () => {
      const h = harness({ checkInvoice: () => Promise.resolve(checkOf("CANCELED")) });

      await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));

      expect(h.api.screen()).toContain("<b>⭐ SUBSCRIBE</b>");
    });

    it.each(["ORPHAN_PAYMENT", "NOT_FOUND"] as const)(
      "%s: « Invoice not found. », and the offers",
      async (kind) => {
        const h = harness({ checkInvoice: () => Promise.resolve(checkOf(kind)) });

        await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));

        expect(h.api.lastAlert()).toMatchObject({ text: "Invoice not found.", show_alert: true });
        expect(h.api.screen()).toContain("⚠️ Invoice not found.");
      },
    );

    it("never shows the invoice of another user", async () => {
      const h = harness();

      await feed(h.bot, callbackUpdate(SUB_CB.paid("cmfq3v0n90000pay0invoice9")));

      expect(h.api.lastAlert()).toMatchObject({ text: "Invoice not found." });
      expect(h.api.screen()).not.toContain(TEST_DEPOSIT);
    });

    it("reads the chain once per invoice every 5 s: a second click gets the same answer", async () => {
      const checkInvoice = vi.fn<InvoicePayments["checkInvoice"]>(() =>
        Promise.resolve(checkOf("NOT_DETECTED")),
      );
      const h = harness(
        { checkInvoice },
        {
          editMessageText: telegramError("editMessageText", "Bad Request: message is not modified"),
        },
      );

      await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));
      await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));

      expect(checkInvoice).toHaveBeenCalledTimes(1);
      // « message is not modified » is not an error: the toast has said it.
      expect(h.api.text("answerCallbackQuery", -1)).toBe(
        "Payment not detected yet. It can take up to a minute.",
      );
      expect(h.api.of("sendMessage")).toHaveLength(0);
    });

    it("an RPC that does not answer: the invoice stays, and says so", async () => {
      const h = harness({ checkInvoice: () => Promise.reject(new Error("RPC down")) });

      await feed(h.bot, callbackUpdate(SUB_CB.paid(TEST_INVOICE_ID)));

      expect(h.api.lastAlert()).toMatchObject({ show_alert: true });
      expect(h.api.screen()).toContain(SEND);
      expect(h.api.screen()).toContain("⚠️ We couldn't check the payment. Try again in a moment.");
    });
  });

  describe("Cancel", () => {
    it("cancels, then the offers", async () => {
      const cancelInvoice = vi.fn<InvoicePayments["cancelInvoice"]>(() =>
        Promise.resolve("CANCELED"),
      );
      const h = harness({ cancelInvoice });

      await feed(h.bot, callbackUpdate(SUB_CB.cancel(TEST_INVOICE_ID)));

      expect(cancelInvoice).toHaveBeenCalledWith(TEST_INVOICE_ID, TEST_USER.id, expect.any(Date));
      expect(h.api.screen()).toContain("<b>⭐ SUBSCRIBE</b>");
    });

    it("on an invoice paid meanwhile: « Payment received »", async () => {
      const h = harness({
        cancelInvoice: () => Promise.resolve("ALREADY_PAID"),
        checkInvoice: () => Promise.resolve(activatedCheck(CHECKED_AT)),
      });

      await feed(h.bot, callbackUpdate(SUB_CB.cancel(TEST_INVOICE_ID)));

      expect(h.api.screen()).toContain("✅ Payment received.");
    });
  });

  it("New invoice: the same offer through the rules, a new invoice", async () => {
    const offer = getOffer("CLASSIC", "ONE_MONTH");
    const createInvoice = vi.fn<InvoicePayments["createInvoice"]>(() =>
      Promise.resolve({ ok: true, invoice: testInvoice({ offer }), reused: false }),
    );
    const h = harness({
      getInvoice: () => Promise.resolve(testInvoice({ offer, status: "EXPIRED" })),
      createInvoice,
    });

    await feed(h.bot, callbackUpdate(SUB_CB.renew(TEST_INVOICE_ID)));

    expect(createInvoice).toHaveBeenCalledWith(expect.objectContaining({ offer }));
    expect(h.api.screen()).toContain("<b>⭐ CLASSIC · 1 MONTH</b>");
  });

  it("Back from a screen of V1-31 draws a pending invoice from the table", async () => {
    const checkInvoice = vi.fn<InvoicePayments["checkInvoice"]>();
    const h = harness({ checkInvoice });

    await feed(h.bot, callbackUpdate(SUB_CB.invoice(TEST_INVOICE_ID)));

    expect(checkInvoice).not.toHaveBeenCalled();
    expect(h.api.screen()).toContain("⏳ Waiting for payment · expires in 30:00");
  });

  it("Back on an invoice that expired meanwhile: how it ended", async () => {
    const h = harness({
      getInvoice: () => Promise.resolve(testInvoice({ status: "EXPIRED" })),
      checkInvoice: () => Promise.resolve(checkOf("EXPIRED")),
    });

    await feed(h.bot, callbackUpdate(SUB_CB.invoice(TEST_INVOICE_ID)));

    expect(h.api.screen()).toContain("⌛ Invoice expired.");
  });
});
