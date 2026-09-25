import { describe, expect, it } from "vitest";
import { createUi } from "../ui/index.js";
import { buildInactiveRefundAlert } from "./inactive-refund.js";
import type { SweptTransfer } from "./swept-transfers.js";

const ui = createUi("devnet");
const MAIN = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TEST = "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81";
// Shaped like signatures, built at runtime: no 88-character base58 literal in the sources.
const SIGNATURE_1 = `5Hq1${"x".repeat(80)}Zk9a`;
const SIGNATURE_2 = `3Ab2${"y".repeat(80)}Qr7s`;

const transfers: SweptTransfer[] = [
  { walletName: "Main", fromAddress: MAIN, lamports: 2_499_985_000n, signature: SIGNATURE_1 },
  { walletName: "<Test>", fromAddress: TEST, lamports: 1_000_000n, signature: SIGNATURE_2 },
];

describe("buildInactiveRefundAlert (V1-45)", () => {
  it("names the user, the total moved and one line per transfer, with devnet links", () => {
    const screen = buildInactiveRefundAlert(ui, {
      user: { telegramId: 123_456_789n, username: "username", firstName: "Alice" },
      transfers,
    });

    expect(screen.text.split("\n")).toEqual([
      "<b>⚠️ MANUAL REFUND</b>",
      "",
      "The user became active while their inactive account was being deleted. Their SOL was already moved to the treasury and the account was kept. Refund the user by hand.",
      "",
      "👤 User: @username (ID <code>123456789</code>)",
      "Moved to treasury: 2.500985 SOL",
      `👛 Main · <a href="https://explorer.solana.com/address/${MAIN}?cluster=devnet">7xKX…gAsU</a> · 2.499985 SOL · Tx <a href="https://explorer.solana.com/tx/${SIGNATURE_1}?cluster=devnet">5Hq1…Zk9a</a>`,
      `👛 &lt;Test&gt; · <a href="https://explorer.solana.com/address/${TEST}?cluster=devnet">3pLm…Aa81</a> · 0.001 SOL · Tx <a href="https://explorer.solana.com/tx/${SIGNATURE_2}?cluster=devnet">3Ab2…Qr7s</a>`,
    ]);
    expect(screen.reply_markup.inline_keyboard).toEqual([]);
  });

  it("names the user by the first name, escaped, then by the id alone", () => {
    const text = (username: string | null, firstName: string | null) =>
      buildInactiveRefundAlert(ui, {
        user: { telegramId: 42n, username, firstName },
        transfers: transfers.slice(0, 1),
      }).text;

    expect(text(null, "Bob & Co")).toContain("👤 User: Bob &amp; Co (ID <code>42</code>)");
    expect(text(null, null)).toContain("👤 User: ID <code>42</code>");
  });
});
