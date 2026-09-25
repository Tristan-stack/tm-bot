import { describe, expect, it } from "vitest";
import { TG } from "../constants.js";
import { createUi } from "../ui/index.js";
import { buildDepositAlert } from "./deposit-alerts.js";
import type { AlertInvoice, DepositAlert } from "./deposit-alerts.js";

const ui = createUi("devnet");
const DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const FROM = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
// Shaped like a signature, built at runtime: no 88-character base58 literal in the sources.
const SIGNATURE = `5Hq1${"x".repeat(80)}Zk9a`;

const invoice = (overrides: Partial<AlertInvoice> = {}): AlertInvoice => ({
  plan: "PREMIUM",
  duration: "TWO_DAYS",
  createdAt: new Date("2026-09-12T14:02:00Z"),
  priceUsd: "59.00",
  expectedLamports: 570_820_434n,
  depositAddress: DEPOSIT,
  status: "EXPIRED",
  ...overrides,
});

const moved = (overrides: Partial<Extract<DepositAlert, { signature: string }>> = {}) =>
  buildDepositAlert(ui, {
    kind: "PARTIAL_EXPIRED",
    invoice: invoice(),
    user: { telegramId: 123_456_789n, username: "username" },
    balanceLamports: 300_000_000n,
    movedLamports: 299_985_000n,
    signature: SIGNATURE,
    from: FROM,
    ...overrides,
  }).text;

describe("buildDepositAlert (V1-33)", () => {
  it("MANUAL REFUND of a partial payment: the invoice, the user, the amounts, the links", () => {
    const text = moved();

    expect(text.split("\n")).toEqual([
      "<b>⚠️ MANUAL REFUND</b>",
      "",
      "Partial payment on an expired invoice. The funds were moved to the treasury. Refund the user by hand.",
      "",
      "🧾 Invoice: Premium · 2 days · created 12 Sep 2026, 14:02 UTC",
      "👤 User: @username (ID 123456789)",
      "Expected: 0.5709 SOL ($59.00)",
      "Received: 0.300 SOL",
      "Moved to treasury: 0.299985 SOL",
      `Deposit: <a href="https://explorer.solana.com/address/${DEPOSIT}?cluster=devnet">9WzD…AWWM</a>`,
      `<code>${DEPOSIT}</code>`,
      `From: <a href="https://explorer.solana.com/address/${FROM}?cluster=devnet">7xKX…gAsU</a>`,
      `Tx: <a href="https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet">5Hq1…Zk9a</a>`,
    ]);
    expect(text.length).toBeLessThanOrEqual(TG.MESSAGE_MAX_CHARS);
  });

  it("is a screen without a button", () => {
    const screen = buildDepositAlert(ui, {
      kind: "OLD_ADDRESS",
      invoice: invoice({ status: "SWEPT" }),
      user: null,
      balanceLamports: 1n,
      movedLamports: 1n,
      signature: SIGNATURE,
    });

    expect(screen.reply_markup.inline_keyboard).toEqual([]);
    expect(screen.parse_mode).toBe("HTML");
  });

  it("LATE_FULL_PAYMENT says no subscription was activated", () => {
    const text = moved({ kind: "LATE_FULL_PAYMENT", balanceLamports: 570_820_434n });

    expect(text).toContain("<b>⚠️ MANUAL REFUND</b>");
    expect(text).toContain("No subscription was activated.");
  });

  it("OLD_ADDRESS has its own title and the status of the invoice", () => {
    const paid = moved({ kind: "OLD_ADDRESS", invoice: invoice({ status: "SWEPT" }) });
    const canceled = moved({ kind: "OLD_ADDRESS", invoice: invoice({ status: "CANCELED" }) });

    expect(paid).toContain("<b>⚠️ OLD DEPOSIT ADDRESS</b>");
    expect(paid).toContain("Funds were sent to an old deposit address.");
    expect(paid).toContain("Status: Paid");
    expect(canceled).toContain("Status: Canceled");
    expect(moved()).not.toContain("Status:");
  });

  it("names a purged account, escapes a username, and drops an unknown sender", () => {
    expect(moved({ user: null })).toContain("👤 User: deleted account");
    expect(moved({ user: { telegramId: 42n, username: null } })).toContain("👤 User: ID 42");
    expect(moved({ user: { telegramId: 42n, username: "a<b>&c" } })).toContain(
      "@a&lt;b&gt;&amp;c (ID 42)",
    );
    const withoutSender = buildDepositAlert(ui, {
      kind: "PARTIAL_EXPIRED",
      invoice: invoice(),
      user: null,
      balanceLamports: 1n,
      movedLamports: 1n,
      signature: SIGNATURE,
    }).text;
    expect(withoutSender).not.toContain("From:");
  });

  it("SWEEP FAILED: the balance, the reason, the attempts when there were retries", () => {
    const failed = (attempts: number | null, balanceLamports: bigint | null) =>
      buildDepositAlert(ui, {
        kind: "SWEEP_FAILED",
        invoice: invoice({ status: "PAID" }),
        user: { telegramId: 123_456_789n, username: null },
        balanceLamports,
        reason: "RPC_UNAVAILABLE",
        attempts,
      }).text;

    const text = failed(9, 570_820_434n);
    expect(text).toContain("<b>⚠️ SWEEP FAILED</b>");
    expect(text).toContain("after 9 attempts. Check the worker logs.");
    expect(text).toContain("Balance: 0.570820434 SOL");
    expect(text).toContain("Reason: RPC_UNAVAILABLE");
    expect(text).not.toContain("Tx:");
    expect(failed(null, null)).toContain("were never moved to the treasury");
    expect(failed(null, null)).toContain("Balance: —");
  });
});
