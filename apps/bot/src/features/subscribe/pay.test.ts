import type {
  InvoiceCheck,
  PayChoices,
  PayOptions,
  PayOutcome,
  PayRequest,
  WalletPaymentService,
} from "@launchbot/db";
import { createUi, isCallbackDataSize } from "@launchbot/shared";
import { consumeRateLimit, resetRateLimits } from "@launchbot/shared/server";
import type { TxFailure } from "@launchbot/solana";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activatedCheck,
  botHarness,
  callbackUpdate,
  confirmData,
  feed,
  keyboardOf,
  MAIN_WALLET,
  TEST_DEPOSIT,
  TEST_EXPECTED,
  TEST_FEE,
  TEST_INVOICE_ID,
  TEST_SIGNATURE,
  TEST_USER,
  TEST_WALLET,
  testInvoice,
} from "../../test-harness.js";
import {
  buildPayChoicesScreen,
  buildPayConfirmScreen,
  buildPayFailureScreen,
  buildPaySendingScreen,
  insufficientBlock,
  PAY_CB,
} from "./pay-screens.js";
import { SUB_CB } from "./screens.js";

const ui = createUi("devnet");
const CHECKED_AT = new Date("2026-09-24T12:05:00Z");
/** A cuid of 25 characters, the longest id a wallet button carries. */
const WALLET_CUID = "cmfq3v0n90000wallet00main";

// Every click counts against the global limit of the user (V1-04).
beforeEach(resetRateLimits);

/** Test holds 0.400 SOL: 0.5708 SOL + fees is out of its reach. */
const POOR_TEST = { ...TEST_WALLET, lamports: 400_000_000n };
const MISSING = TEST_EXPECTED + TEST_FEE - 400_000_000n;

const choices = (overrides: Partial<PayChoices> = {}): PayChoices => ({
  invoice: testInvoice(),
  feeLamports: 15_000n,
  wallets: [
    { wallet: MAIN_WALLET, missingLamports: 0n },
    { wallet: POOR_TEST, missingLamports: MISSING },
  ],
  ...overrides,
});

const HEADER = "<b>👛 PAY FROM WALLET</b> · 🧪 Devnet";
const INVOICE_LINE = "⭐ Premium · 2 days · 0.5709 SOL ($59.00)";

describe("Pay from my wallet screens (§8.3)", () => {
  it("lists the wallets, oldest first, with what each one lacks", () => {
    const screen = buildPayChoicesScreen(ui, choices());

    expect(screen.text).toBe(
      [
        HEADER,
        "Choose the wallet that pays this invoice.",
        [
          `${INVOICE_LINE}\n⛽ Fees: ≈ 0.000015 SOL`,
          "┌ Main · 2.500 SOL ✅\n└ Test · 0.400 SOL ⚠️ Insufficient funds (0.1709 SOL missing)",
        ].join("\n\n"),
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [{ text: "👛 Main", callback_data: `sub:pw:w:${TEST_INVOICE_ID}:w1` }],
      [{ text: "👛 Test", callback_data: `sub:pw:w:${TEST_INVOICE_ID}:w2` }],
      [{ text: "❌ Cancel", callback_data: `sub:inv:${TEST_INVOICE_ID}` }],
    ]);
  });

  it("draws a middle branch, a partial payment and an unknown balance", () => {
    const partial = testInvoice({
      receivedLamports: 300_000_000n,
      remainingLamports: 270_820_434n,
    });
    const screen = buildPayChoicesScreen(
      ui,
      choices({
        invoice: partial,
        wallets: [
          { wallet: MAIN_WALLET, missingLamports: 0n },
          { wallet: { ...TEST_WALLET, lamports: null }, missingLamports: null },
          { wallet: { ...POOR_TEST, id: "w3", name: "<b>Third</b>" }, missingLamports: 1n },
        ],
      }),
    );

    expect(screen.text).toContain(
      `${INVOICE_LINE}\n⚠️ Partial payment: 0.3000 SOL received, 0.2709 SOL still to send.`,
    );
    expect(screen.text).toContain(
      "┌ Main · 2.500 SOL ✅\n├ Test · — SOL\n└ &lt;b&gt;Third&lt;/b&gt; · 0.400 SOL ⚠️ Insufficient funds (0.0001 SOL missing)",
    );
  });

  it("without a wallet: the text of §10.1, Wallets and Back", () => {
    const screen = buildPayChoicesScreen(ui, choices({ wallets: [] }));

    expect(screen.text).toBe(
      [HEADER, "You have no wallet yet. Create or import one first.", INVOICE_LINE].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "👛 Wallets", callback_data: "wal:list" },
        { text: "⬅️ Back", callback_data: `sub:inv:${TEST_INVOICE_ID}` },
      ],
    ]);
  });

  it("the note of a wallet that cannot pay: how much, and where to send it", () => {
    const block = insufficientBlock(testInvoice(), POOR_TEST, MISSING);

    expect(block.alert).toBe("Test can't cover this payment.");
    expect(block.flag).toBe(
      [
        "⚠️ INSUFFICIENT FUNDS",
        "Test can't cover 0.5709 SOL + fees: 0.1709 SOL missing.",
        "Send SOL to Test, then tap it again:",
        `<code>${TEST_WALLET.publicKey}</code>`,
      ].join("\n"),
    );
  });

  it("the confirmation: source, amount, deposit address, fees and network", () => {
    const screen = buildPayConfirmScreen(
      ui,
      { invoice: testInvoice(), feeLamports: 15_000n, wallet: MAIN_WALLET },
      "a1b2c3d4",
    );

    expect(screen.text).toBe(
      [
        "<b>👛 CONFIRM PAYMENT</b> · 🧪 Devnet",
        "Check the payment, then tap Confirm. The SOL is sent right away.",
        [
          "⭐ For: Premium · 2 days",
          "From: Main · 7xKX…gAsU · 2.500 SOL",
          "💰 Amount: 0.5709 SOL ($59.00)",
          `To: <code>${TEST_DEPOSIT}</code>`,
          "⛽ Fees: ≈ 0.000015 SOL",
          "🧪 Network: Solana Devnet",
        ].join("\n"),
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "✅ Confirm", callback_data: "sub:pw:ok:a1b2c3d4" },
        { text: "❌ Cancel", callback_data: `sub:inv:${TEST_INVOICE_ID}` },
      ],
    ]);
  });

  it("the rest of a partial payment carries no dollar value of its own", () => {
    const invoice = testInvoice({
      receivedLamports: 300_000_000n,
      remainingLamports: 270_820_434n,
    });
    const screen = buildPayConfirmScreen(
      ui,
      { invoice, feeLamports: 5_000n, wallet: MAIN_WALLET },
      "t",
    );

    expect(screen.text).toContain("💰 Amount: 0.2709 SOL\n");
  });

  it("sending: no button to click twice", () => {
    const screen = buildPaySendingScreen(ui, {
      invoice: testInvoice(),
      feeLamports: 5_000n,
      wallet: MAIN_WALLET,
    });

    expect(screen.text).toBe(
      [
        "<b>👛 SENDING PAYMENT</b> · 🧪 Devnet",
        "Sending 0.5709 SOL from Main. This can take a few seconds.",
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([]);
  });

  it("a failure: the reason of V1-13, whether anything left, Try again and Back", () => {
    const failure: TxFailure = { ok: false, code: "TRANSACTION_REJECTED", landed: "no" };
    const screen = buildPayFailureScreen(ui, {
      paymentId: TEST_INVOICE_ID,
      wallet: MAIN_WALLET,
      failure,
    });

    expect(screen.text).toBe(
      [
        "<b>❌ PAYMENT FAILED</b> · 🧪 Devnet",
        "The payment could not be sent. Your invoice is still open.",
        [
          "Reason: The network rejected the transaction.",
          "Nothing was sent.",
          "From: Main · 2.500 SOL",
        ].join("\n"),
      ].join("\n\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "🔁 Try again", callback_data: "sub:pw:re" },
        { text: "⬅️ Back", callback_data: `sub:inv:${TEST_INVOICE_ID}` },
      ],
    ]);
  });

  it("keeps every callback data within 64 bytes, cuid ids included", () => {
    for (const data of [
      PAY_CB.wallet(TEST_INVOICE_ID, WALLET_CUID),
      PAY_CB.confirm("a1b2c3d4"),
      PAY_CB.tryAgain,
      SUB_CB.payFromWallet(TEST_INVOICE_ID),
    ]) {
      expect(isCallbackDataSize(data)).toBe(true);
    }
  });
});

describe("Pay from my wallet clicks (§8.3)", () => {
  const harness = (walletPayments: Partial<WalletPaymentService> = {}) =>
    botHarness({ walletPayments });

  /** Pay from my wallet, then Main: the confirmation is on the screen. */
  async function toConfirm(h: ReturnType<typeof harness>) {
    await feed(h.bot, callbackUpdate(SUB_CB.payFromWallet(TEST_INVOICE_ID)));
    await feed(h.bot, callbackUpdate(PAY_CB.wallet(TEST_INVOICE_ID, MAIN_WALLET.id)));
    return confirmData(h.api);
  }

  const payWith = (outcome: PayOutcome) =>
    vi.fn<WalletPaymentService["pay"]>(() => Promise.resolve(outcome));

  it("opens the choice from the invoice", async () => {
    const listChoices = vi.fn<WalletPaymentService["listChoices"]>(() =>
      Promise.resolve({ status: "ok", ...choices() }),
    );
    const h = harness({ listChoices });

    await feed(h.bot, callbackUpdate(SUB_CB.payFromWallet(TEST_INVOICE_ID)));

    expect(listChoices).toHaveBeenCalledWith(TEST_USER.id, TEST_INVOICE_ID);
    expect(h.api.screen()).toContain("Choose the wallet that pays this invoice.");
  });

  it("an invoice paid meanwhile: « Payment received », nothing to choose", async () => {
    const h = harness({
      listChoices: () => Promise.resolve({ status: "blocked", check: activatedCheck(CHECKED_AT) }),
    });

    await feed(h.bot, callbackUpdate(SUB_CB.payFromWallet(TEST_INVOICE_ID)));

    expect(h.api.screen()).toContain("✅ Payment received.");
  });

  it("a wallet that cannot pay: the alert, and the list with the note", async () => {
    const h = harness({
      quote: () =>
        Promise.resolve({
          status: "insufficient",
          ...choices(),
          wallet: POOR_TEST,
          missingLamports: MISSING,
        }),
    });

    await feed(h.bot, callbackUpdate(PAY_CB.wallet(TEST_INVOICE_ID, TEST_WALLET.id)));

    expect(h.api.lastAlert()).toMatchObject({
      text: "Test can't cover this payment.",
      show_alert: true,
    });
    expect(h.api.screen()).toContain("⚠️ INSUFFICIENT FUNDS\nTest can't cover 0.5709 SOL");
    expect(h.api.screen()).toContain("┌ Main · 2.500 SOL ✅");
  });

  it("a wallet that is not the user's: the list says so", async () => {
    const h = harness();

    await feed(h.bot, callbackUpdate(PAY_CB.wallet(TEST_INVOICE_ID, "someone-else")));

    expect(h.api.lastAlert()).toMatchObject({ text: "This wallet no longer exists." });
    expect(h.api.screen()).toContain("⚠️ This wallet no longer exists.");
  });

  it("Confirm: the sending screen, then « Payment received »", async () => {
    const pay = vi.fn<WalletPaymentService["pay"]>(async (_userId, request, options = {}) => {
      await options.onSending?.({
        invoice: testInvoice(),
        feeLamports: TEST_FEE,
        wallet: MAIN_WALLET,
      });
      return { status: "sent", check: activatedCheck(CHECKED_AT) };
    });
    const h = harness({ pay });

    await feed(h.bot, callbackUpdate(await toConfirm(h)));

    const request: PayRequest = {
      paymentId: TEST_INVOICE_ID,
      walletId: MAIN_WALLET.id,
      amountLamports: TEST_EXPECTED,
    };
    expect(pay).toHaveBeenCalledWith(TEST_USER.id, request, expect.anything());
    const screens = h.api.of("editMessageText").map((call) => String(call.payload["text"]));
    expect(screens.at(-2)).toContain("Sending 0.5709 SOL from Main.");
    expect(screens.at(-1)).toContain("✅ Payment received. Premium is active until");
  });

  it("a second click on the same Confirm is a stale button, not a second send", async () => {
    const pay = payWith({ status: "sent", check: activatedCheck(CHECKED_AT) });
    const h = harness({ pay });
    const confirm = await toConfirm(h);

    await feed(h.bot, callbackUpdate(confirm));
    await feed(h.bot, callbackUpdate(confirm));

    expect(pay).toHaveBeenCalledTimes(1);
    expect(h.api.text("answerCallbackQuery", -1)).toBe(
      "This button has expired. Please use the menu.",
    );
  });

  it("sent, not activated yet: the invoice says the payment is on its way", async () => {
    const check: InvoiceCheck = {
      kind: "NOT_DETECTED",
      invoice: testInvoice(),
      checkedAt: CHECKED_AT,
    };
    const h = harness({ pay: payWith({ status: "sent", check }) });

    await feed(h.bot, callbackUpdate(await toConfirm(h)));

    expect(h.api.screen()).toContain("⏳ Payment sent, waiting for confirmation…");
  });

  it("an outcome still unknown: no failure, no Try again, and the next Confirm reads it first", async () => {
    const outcomes: PayOutcome[] = [
      {
        status: "unconfirmed",
        signature: TEST_SIGNATURE,
        check: { kind: "NOT_DETECTED", invoice: testInvoice(), checkedAt: CHECKED_AT },
      },
      { status: "sent", check: activatedCheck(CHECKED_AT) },
    ];
    const seen: (PayOptions["inFlight"] | undefined)[] = [];
    const h = harness({
      pay: (_userId, _request, options = {}) => {
        seen.push(options.inFlight);
        return Promise.resolve(outcomes.shift() ?? outcomes[0]!);
      },
    });

    await feed(h.bot, callbackUpdate(await toConfirm(h)));
    expect(h.api.screen()).toContain("⏳ Payment sent, waiting for confirmation…");
    expect(h.api.screen()).not.toContain("Try again");

    await feed(h.bot, callbackUpdate(await toConfirm(h)));
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toMatchObject({ signature: TEST_SIGNATURE });
  });

  it("a failure: the reason, then Try again quotes again", async () => {
    const quote = vi.fn<WalletPaymentService["quote"]>(() =>
      Promise.resolve({
        status: "ok",
        invoice: testInvoice(),
        feeLamports: TEST_FEE,
        wallet: MAIN_WALLET,
      }),
    );
    const h = harness({
      quote,
      pay: payWith({
        status: "failed",
        wallet: MAIN_WALLET,
        failure: { ok: false, code: "BLOCKHASH_EXPIRED", landed: "no" },
      }),
    });

    await feed(h.bot, callbackUpdate(await toConfirm(h)));
    expect(h.api.screen()).toContain("Reason: The network didn't confirm the transaction in time.");

    await feed(h.bot, callbackUpdate(PAY_CB.tryAgain));
    expect(quote).toHaveBeenCalledTimes(2);
    expect(h.api.screen()).toContain("<b>👛 CONFIRM PAYMENT</b>");
  });

  it("an amount that changed: the confirmation again, with the line", async () => {
    const partial = testInvoice({
      receivedLamports: 300_000_000n,
      remainingLamports: 270_820_434n,
    });
    const h = harness({
      pay: payWith({
        status: "amount_changed",
        invoice: partial,
        feeLamports: TEST_FEE,
        wallet: MAIN_WALLET,
      }),
    });

    await feed(h.bot, callbackUpdate(await toConfirm(h)));

    expect(h.api.screen()).toContain("💰 Amount: 0.2709 SOL");
    expect(h.api.screen()).toContain("⚠️ Amount updated.");
  });

  it("another payment of the same invoice in flight: nothing sent, the line says it", async () => {
    const h = harness({ pay: payWith({ status: "locked" }) });

    await feed(h.bot, callbackUpdate(await toConfirm(h)));

    expect(h.api.screen()).toContain("⚠️ A payment is already being sent.");
  });

  it("an invoice that expired before the Confirm: how it ended, nothing sent", async () => {
    const h = harness({
      pay: payWith({
        status: "blocked",
        check: {
          kind: "EXPIRED",
          invoice: testInvoice({ status: "EXPIRED" }),
          checkedAt: CHECKED_AT,
        },
      }),
    });

    await feed(h.bot, callbackUpdate(await toConfirm(h)));

    expect(h.api.screen()).toContain("⌛ Invoice expired.");
  });

  it("too many attempts: the alert, and the confirmation with the line", async () => {
    const pay = vi.fn<WalletPaymentService["pay"]>();
    const h = harness({ pay });
    const confirm = await toConfirm(h);
    for (let i = 0; i < 5; i++) consumeRateLimit(Number(TEST_USER.telegramId), "payFromWallet");

    await feed(h.bot, callbackUpdate(confirm));

    expect(pay).not.toHaveBeenCalled();
    expect(h.api.lastAlert()).toMatchObject({
      text: "Too many payment attempts. Try again in a few minutes.",
      show_alert: true,
    });
    expect(h.api.screen()).toContain("⚠️ Too many payment attempts.");
  });
});
