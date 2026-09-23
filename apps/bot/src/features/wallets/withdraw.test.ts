import type { WithdrawalService } from "@launchbot/db";
import { createUi, en, isCallbackDataSize, NAV_HOME, RATE_LIMITS } from "@launchbot/shared";
import { consumeRateLimit, resetRateLimits } from "@launchbot/shared/server";
import type { TxFailure } from "@launchbot/solana";
import type { Bot } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext, WithdrawMode } from "../../context.js";
import {
  botHarness,
  callbackUpdate,
  fakeWithdrawals,
  feed,
  keyboardOf,
  MAIN_WALLET,
  photoUpdate,
  storedSession,
  TEST_FEE,
  TEST_RENT_MIN,
  TEST_SIGNATURE,
  TEST_USER,
  TEST_WALLET,
  testQuote,
  testWithdrawal,
  textUpdate,
} from "../../test-harness.js";
import { WALLET_CB } from "./screens.js";
import {
  buildWithdrawAddressScreen,
  buildWithdrawAmountScreen,
  buildWithdrawConfirmScreen,
  buildWithdrawCustomScreen,
  buildWithdrawFailureScreen,
  buildWithdrawOffCurveScreen,
  buildWithdrawSuccessScreen,
  refusalOf,
  txFailureText,
  WITHDRAW_CB,
} from "./withdraw-screens.js";
import type { WithdrawView } from "./withdraw-screens.js";

const ui = createUi("devnet");
const MAIN = MAIN_WALLET;
const BALANCE = MAIN.lamports ?? 0n;
/** The wallet of the user the withdrawal goes to: another wallet of theirs is accepted. */
const TO = TEST_WALLET.publicKey;
/** A program address of the System program: not on the ed25519 curve. */
const OFF_CURVE = "3QaHsYw2ZQwTdTC2NmN6iwZy6UJEdMWksweeCqBci9VF";
const SOL_USD = 103.36;

const view = (mode: WithdrawMode = "normal"): WithdrawView => ({
  wallet: MAIN,
  solUsd: SOL_USD,
  mode,
});
const amountView = (mode: WithdrawMode = "normal") => ({
  ...view(mode),
  to: TO,
  lamports: BALANCE,
  feeLamports: TEST_FEE,
  maxLamports: BALANCE - TEST_FEE,
  rentMinLamports: TEST_RENT_MIN,
});

const HEADER_1 = "<b>📤 WITHDRAW · STEP 1/3</b> · 🧪 Devnet\n▰▱▱\nAddress › Amount › Confirm";
const HEADER_2 = "<b>📤 WITHDRAW · STEP 2/3</b> · 🧪 Devnet\n▰▰▱\nAddress › Amount › Confirm";
const HEADER_3 = "<b>📤 WITHDRAW · STEP 3/3</b> · 🧪 Devnet\n▰▰▰\nAddress › Amount › Confirm";
const FROM_LINE = "👛 From: Main · 7xKX…gAsU";
const CANCEL = { text: "❌ Cancel", callback_data: "wal:v:w1" };

beforeEach(resetRateLimits);

describe("withdraw screens", () => {
  it("asks for the address with the balance, as the mockup of §9.5", () => {
    const screen = buildWithdrawAddressScreen(ui, view(), BALANCE);

    expect(screen.text).toBe(
      [
        HEADER_1,
        "",
        "Send the destination address.",
        "",
        FROM_LINE,
        "💰 Balance: 2.500 SOL ($258.40)",
        "Format: a Solana address, different from this wallet.",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([[CANCEL]]);
  });

  it("counts two steps and announces Max in mode all", () => {
    const text = buildWithdrawAddressScreen(ui, view("all"), BALANCE).text;

    expect(text).toContain("<b>📤 WITHDRAW · STEP 1/2</b> · 🧪 Devnet\n▰▱\nAddress › Confirm");
    expect(text).toContain("💰 Balance: 2.500 SOL ($258.40)\n💰 Amount: Max (balance − fees)\n");
  });

  it("warns about an address off the curve, with Continue anyway", () => {
    const screen = buildWithdrawOffCurveScreen(ui, view(), OFF_CURVE);

    expect(screen.text).toBe(
      [
        HEADER_1,
        "",
        "⚠️ This address is not on the ed25519 curve. It is often a program account: SOL sent there may be lost.",
        "",
        `📍 To: ${OFF_CURVE}`,
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [{ text: "⚠️ Continue anyway", callback_data: "wal:wx:go" }, CANCEL],
    ]);
  });

  it("offers the shares, Max and Custom with the fees and the maximum", () => {
    const screen = buildWithdrawAmountScreen(ui, amountView());

    expect(screen.text).toBe(
      [
        HEADER_2,
        "",
        "Choose how much SOL to send.",
        "",
        FROM_LINE,
        "📍 To: 3pLm…Aa81",
        "💰 Available: 2.500 SOL ($258.40)",
        "⛽ Fees: ≈ 0.000005 SOL · Max: 2.499995 SOL",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "25%", callback_data: "wal:wx:p25" },
        { text: "50%", callback_data: "wal:wx:p50" },
        { text: "Max", callback_data: "wal:wx:max" },
      ],
      [{ text: "✏️ Custom", callback_data: "wal:wx:cus" }],
      [CANCEL],
    ]);
  });

  it("asks for a custom amount with the maximum and the rent-exempt minimum", () => {
    const screen = buildWithdrawCustomScreen(ui, amountView());

    expect(screen.text).toBe(
      [
        HEADER_2,
        "",
        "Send the amount in SOL.",
        "",
        FROM_LINE,
        "📍 To: 3pLm…Aa81",
        "💰 Available: 2.500 SOL ($258.40)",
        "Rules: a number like 0.5 (up to 9 decimals), at most 2.499995 SOL. The balance left must be 0 or at least 0.00089 SOL.",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([[CANCEL]]);
  });

  it("confirms with the full address, exact amounts, the network and a token", () => {
    const screen = buildWithdrawConfirmScreen(ui, view(), testQuote(), "abcd1234");

    expect(screen.text).toBe(
      [
        HEADER_3,
        "",
        "Check the withdrawal. A sent transaction can't be reversed.",
        "",
        FROM_LINE,
        `📍 To: <code>${TO}</code>`,
        "💰 Amount: 1.250 SOL ($129.20)",
        "⛽ Fees: ≈ 0.000005 SOL",
        "🧪 Network: Solana Devnet",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [{ text: "✅ Confirm", callback_data: "wal:wx:ok:abcd1234" }, CANCEL],
    ]);
    expect(isCallbackDataSize(WITHDRAW_CB.confirm("abcd1234"))).toBe(true);
  });

  it("says Max on the confirmation of a Max, in two steps in mode all", () => {
    const quote = testQuote({ mode: "max", amountLamports: BALANCE - TEST_FEE });
    const text = buildWithdrawConfirmScreen(ui, view("all"), quote, "t").text;

    expect(text).toContain("<b>📤 WITHDRAW · STEP 2/2</b> · 🧪 Devnet\n▰▰\nAddress › Confirm");
    expect(text).toContain("💰 Amount: 2.499995 SOL ($258.40) (Max)");
  });

  it("shows the result of a sent withdrawal with the explorer link of the signature", () => {
    const screen = buildWithdrawSuccessScreen(ui, {
      walletId: "w1",
      withdrawal: testWithdrawal(),
      solUsd: SOL_USD,
    });

    expect(screen.text).toBe(
      [
        "<b>📤 WITHDRAW</b> · 🧪 Devnet",
        "",
        "✅ Withdrawal sent.",
        "💰 Amount: 1.250 SOL ($129.20)",
        `📍 To: <code>${TO}</code>`,
        "⛽ Fees: 0.000005 SOL",
        `🔍 Signature: <a href="https://explorer.solana.com/tx/${TEST_SIGNATURE}?cluster=devnet">5KtP…x9Qm</a>`,
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "⬅️ Back to wallet", callback_data: "wal:v:w1" },
        { text: "🏠 Menu", callback_data: "nav:home" },
      ],
    ]);
  });

  it("shows a failure with its reason, and Nothing was sent only when nothing was", () => {
    const expired: TxFailure = { ok: false, code: "BLOCKHASH_EXPIRED", landed: "no" };
    const screen = buildWithdrawFailureScreen(ui, {
      wallet: MAIN,
      withdrawal: testWithdrawal({ status: "FAILED", signature: null }),
      failure: expired,
    });

    expect(screen.text).toBe(
      [
        "<b>📤 WITHDRAW</b> · 🧪 Devnet",
        "",
        "❌ Withdrawal failed.",
        "Reason: The network didn't confirm the transaction in time.",
        "Nothing was sent.",
        "",
        FROM_LINE,
        "📍 To: 3pLm…Aa81",
        "💰 Amount: 1.250 SOL",
      ].join("\n"),
    );
    expect(keyboardOf(screen)).toEqual([
      [
        { text: "🔁 Try again", callback_data: "wal:wx:re" },
        { text: "⬅️ Back to wallet", callback_data: "wal:v:w1" },
      ],
    ]);
  });

  it("links the signature of an attempt whose outcome is unknown", () => {
    const unknown: TxFailure = {
      ok: false,
      code: "CONFIRMATION_UNKNOWN",
      landed: "unknown",
      signature: TEST_SIGNATURE,
    };
    const text = buildWithdrawFailureScreen(ui, {
      wallet: MAIN,
      withdrawal: testWithdrawal({ status: "PENDING" }),
      failure: unknown,
    }).text;

    expect(text).not.toContain("Nothing was sent.");
    expect(text).toContain(
      "Reason: The transaction was sent but is not confirmed yet. Check the explorer before trying again.",
    );
    expect(text).toContain(
      `🔍 Signature: <a href="https://explorer.solana.com/tx/${TEST_SIGNATURE}`,
    );
  });

  it("formats the amounts of the rules of §9.5 in the texts and the flags", () => {
    const insufficient: TxFailure = {
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      landed: "no",
      missingLamports: 100_000_000n,
    };
    const rent = (code: "REMAINING_BELOW_RENT" | "DESTINATION_BELOW_RENT"): TxFailure => ({
      ok: false,
      code,
      landed: "no",
      rentMinLamports: TEST_RENT_MIN,
    });

    expect(txFailureText(insufficient)).toBe(
      "Not enough SOL for this amount plus fees (0.100 SOL missing).",
    );
    expect(refusalOf(insufficient)).toEqual({
      alert: "Insufficient funds (0.100 SOL missing)",
      flag: "⚠️ Insufficient funds (0.100 SOL missing)",
    });
    expect(refusalOf(rent("REMAINING_BELOW_RENT")).flag).toBe(
      "⚠️ The balance left would be below the rent-exempt minimum (0.00089 SOL). Choose Max or a smaller amount.",
    );
    // No shorter text of its own: the flag is the text of V1-13.
    expect(refusalOf(rent("DESTINATION_BELOW_RENT")).flag).toBe(
      "⚠️ This address is empty: send at least 0.00089 SOL.",
    );
    expect(refusalOf({ ok: false, code: "RPC_UNAVAILABLE", landed: "no" })).toEqual({
      alert: "Solana devnet is not responding. Try again in a moment.",
      flag: "⚠️ Solana devnet is not responding. Try again in a moment.",
    });
  });
});

type Api = ReturnType<typeof botHarness>["api"];
/** The last screen the bot edited: every step of a flow lands there. */
const lastEdit = (api: Api) => api.text("editMessageText", -1);
const alerts = (api: Api) => api.of("answerCallbackQuery").map((call) => call.payload["text"]);

const open = (bot: Bot<BotContext>, preset?: "max") =>
  feed(
    bot,
    callbackUpdate(preset === "max" ? WALLET_CB.withdrawAll("w1") : WALLET_CB.withdraw("w1")),
  );

/** Address, then 25%: the confirmation screen is the last edit. */
async function reachConfirm(bot: Bot<BotContext>) {
  await open(bot);
  await feed(bot, textUpdate(TO));
  await feed(bot, callbackUpdate(WITHDRAW_CB.pct(25)));
}

/** The Confirm button of the last screen: `wal:wx:ok:<token>`. */
const confirmData = (api: Api): string => {
  const button = api.keyboard("editMessageText", -1)[0]?.[0];
  if (button === undefined || !("callback_data" in button)) throw new Error("no Confirm");
  return button.callback_data;
};

/** The summary of the wallet a failed outcome carries. */
const MAIN_SUMMARY = {
  id: MAIN.id,
  name: MAIN.name,
  publicKey: MAIN.publicKey,
  createdAt: MAIN.createdAt,
};

describe("withdraw handlers", () => {
  it("opens the address step from the detail, and remembers the flow in the session", async () => {
    const { bot, api, prisma } = botHarness();

    await open(bot);

    expect(lastEdit(api)).toContain(HEADER_1);
    expect(lastEdit(api)).toContain("Send the destination address.");
    expect(storedSession(prisma)?.pendingInput).toEqual({ kind: "withdraw_address" });
    expect(storedSession(prisma)?.withdraw).toEqual({ walletId: "w1", mode: "normal" });
  });

  it("refuses to open when the balance does not cover the fees, on the detail", async () => {
    const { bot, api } = botHarness({
      withdrawals: {
        check: () =>
          Promise.resolve({
            status: "nothing_to_withdraw",
            detail: {
              wallet: { ...MAIN, lamports: 1_000n },
              fetchedAt: new Date(),
              status: "fresh",
            },
          }),
      },
    });

    await open(bot);

    expect(alerts(api)).toContain("Nothing to withdraw: the balance doesn't cover the fees.");
    expect(lastEdit(api)).toContain("<b>👛 Main</b>");
    expect(lastEdit(api)).toContain("⚠️ Nothing to withdraw: the balance doesn't cover the fees.");
  });

  it("flags an invalid address and the address of the wallet itself, and keeps waiting", async () => {
    const { bot, api, prisma } = botHarness();
    await open(bot);

    await feed(bot, textUpdate("not an address"));
    expect(lastEdit(api)).toContain("⚠️ Invalid address. Send a Solana address.");

    await feed(bot, textUpdate(MAIN.publicKey));
    expect(lastEdit(api)).toContain("⚠️ This is the address of Main. Send a different address.");

    await feed(bot, photoUpdate());
    expect(lastEdit(api)).toContain("⚠️ Send the address as a text message.");
    expect(storedSession(prisma)?.pendingInput).toEqual({ kind: "withdraw_address" });
    expect(api.of("deleteMessage")).toHaveLength(3);
  });

  it("goes to the amount step on a valid address, editing the screen in place", async () => {
    const { bot, api, prisma } = botHarness();
    await open(bot);

    await feed(bot, textUpdate(TO));

    expect(api.of("sendMessage")).toEqual([]);
    expect(lastEdit(api)).toContain(HEADER_2);
    expect(lastEdit(api)).toContain("⛽ Fees: ≈ 0.000005 SOL · Max: 2.499995 SOL");
    expect(storedSession(prisma)?.pendingInput).toBeUndefined();
    expect(storedSession(prisma)?.withdraw).toEqual({
      walletId: "w1",
      mode: "normal",
      toAddress: TO,
    });
  });

  it("warns about an address off the curve, and goes on with Continue anyway", async () => {
    const { bot, api } = botHarness();
    await open(bot);

    await feed(bot, textUpdate(OFF_CURVE));
    expect(lastEdit(api)).toContain("⚠️ This address is not on the ed25519 curve.");

    await feed(bot, callbackUpdate(WITHDRAW_CB.continueAnyway));
    expect(lastEdit(api)).toContain(HEADER_2);
    expect(lastEdit(api)).toContain("📍 To: 3QaH…i9VF");
  });

  it("quotes a share of the balance and shows the confirmation with a token", async () => {
    const { bot, api, prisma } = botHarness();

    await reachConfirm(bot);

    expect(lastEdit(api)).toContain(HEADER_3);
    expect(lastEdit(api)).toContain("💰 Amount: 0.625 SOL ($64.60)");
    expect(confirmData(api)).toMatch(/^wal:wx:ok:[0-9a-f]{8}$/);
    expect(storedSession(prisma)?.withdraw).toEqual({
      walletId: "w1",
      mode: "normal",
      toAddress: TO,
      amount: "625000000",
      confirmToken: confirmData(api).slice("wal:wx:ok:".length),
    });
  });

  it("takes a custom amount, with a comma and the unit, and flags one it cannot read", async () => {
    const { bot, api, prisma } = botHarness();
    await open(bot);
    await feed(bot, textUpdate(TO));

    await feed(bot, callbackUpdate(WITHDRAW_CB.custom));
    expect(lastEdit(api)).toContain("Send the amount in SOL.");
    expect(storedSession(prisma)?.pendingInput).toEqual({ kind: "withdraw_amount" });

    await feed(bot, textUpdate("abc"));
    expect(lastEdit(api)).toContain("⚠️ Invalid amount. Send a number like 0.5.");

    await feed(bot, textUpdate("0,5 SOL"));
    expect(lastEdit(api)).toContain(HEADER_3);
    expect(lastEdit(api)).toContain("💰 Amount: 0.500 SOL ($51.68)");
  });

  it("sends the user back to the amount step with the flag when the rules refuse it", async () => {
    const quote: WithdrawalService["quote"] = async (userId, walletId, to, amount) => {
      const checked = await fakeWithdrawals().check(userId, walletId);
      if (checked.status !== "ok") throw new Error("unexpected");
      return amount.kind === "pct"
        ? {
            status: "refused",
            check: checked,
            failure: {
              ok: false,
              code: "INSUFFICIENT_FUNDS",
              landed: "no",
              missingLamports: 100_000_000n,
            },
          }
        : { status: "ok", check: checked, quote: testQuote({ to }) };
    };
    const { bot, api } = botHarness({ withdrawals: { quote } });
    await open(bot);
    await feed(bot, textUpdate(TO));

    await feed(bot, callbackUpdate(WITHDRAW_CB.pct(25)));

    expect(alerts(api)).toContain("Insufficient funds (0.100 SOL missing)");
    expect(lastEdit(api)).toContain(HEADER_2);
    expect(lastEdit(api)).toContain("⚠️ Insufficient funds (0.100 SOL missing)");
  });

  it("ends the flow on Cancel, and on any other screen: an old step button is stale", async () => {
    const { bot, api, prisma } = botHarness();
    await reachConfirm(bot);

    await feed(bot, callbackUpdate(WALLET_CB.view("w1")));
    expect(lastEdit(api)).toContain("<b>👛 Main</b> · 🧪 Devnet");
    expect(storedSession(prisma)?.withdraw).toBeUndefined();
    expect(storedSession(prisma)?.pendingInput).toBeUndefined();

    await reachConfirm(bot);
    await feed(bot, callbackUpdate(NAV_HOME));
    expect(storedSession(prisma)?.withdraw).toBeUndefined();

    await feed(bot, callbackUpdate(WITHDRAW_CB.max));
    expect(alerts(api)).toContain(en.common.staleButton);
    expect(lastEdit(api)).toContain("<b>👛 WALLETS");
  });

  it("sends on Confirm: answers the query, shows Sending, then the result", async () => {
    const execute = vi.fn(fakeWithdrawals().execute);
    const { bot, api, prisma } = botHarness({ withdrawals: { execute } });
    await reachConfirm(bot);

    await feed(bot, callbackUpdate(confirmData(api)));

    expect(execute).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, "w1", TO, {
      kind: "exact",
      lamports: 625_000_000n,
    });
    expect(api.text("editMessageText", -2)).toBe(
      "<b>📤 WITHDRAW</b> · 🧪 Devnet\n\n⏳ Sending 0.625 SOL…",
    );
    expect(lastEdit(api)).toContain("✅ Withdrawal sent.");
    expect(lastEdit(api)).toContain("💰 Amount: 0.625 SOL ($64.60)");
    expect(lastEdit(api)).toContain(`?cluster=devnet">5KtP…x9Qm</a>`);
    expect(storedSession(prisma)?.withdraw).toBeUndefined();
  });

  it("sends once on a double Confirm: the second click is a stale button", async () => {
    const execute = vi.fn(fakeWithdrawals().execute);
    const { bot, api } = botHarness({ withdrawals: { execute } });
    await reachConfirm(bot);
    const data = confirmData(api);

    await feed(bot, callbackUpdate(data));
    await feed(bot, callbackUpdate(data));

    expect(execute).toHaveBeenCalledOnce();
    expect(alerts(api)).toContain(en.common.staleButton);
  });

  it("blocks Confirm over the withdrawal limit, with the flag, and sends nothing", async () => {
    const execute = vi.fn<WithdrawalService["execute"]>();
    const { bot, api } = botHarness({ withdrawals: { execute } });
    await reachConfirm(bot);
    for (let i = 0; i < RATE_LIMITS.withdrawal.limit; i++) {
      consumeRateLimit(Number(TEST_USER.telegramId), "withdrawal");
    }

    await feed(bot, callbackUpdate(confirmData(api)));

    expect(execute).not.toHaveBeenCalled();
    expect(alerts(api)).toContain("Too many withdrawals. Try again in a few minutes.");
    expect(lastEdit(api)).toContain(HEADER_3);
    expect(lastEdit(api)).toContain("⚠️ Too many withdrawals. Try again in a few minutes.");
  });

  it("blocks Confirm while an attempt of this wallet is still in flight", async () => {
    const execute = vi.fn<WithdrawalService["execute"]>();
    const { bot, api } = botHarness({
      withdrawals: {
        execute,
        resolve: () => Promise.resolve(testWithdrawal({ status: "PENDING" })),
      },
    });
    await reachConfirm(bot);

    await feed(bot, callbackUpdate(confirmData(api)));

    expect(execute).not.toHaveBeenCalled();
    expect(alerts(api)).toContain("A withdrawal is already in progress.");
    expect(lastEdit(api)).toContain("⚠️ A withdrawal is already in progress.");
  });

  it("shows a failure, and Try again brings the confirmation back", async () => {
    const failure: TxFailure = { ok: false, code: "BLOCKHASH_EXPIRED", landed: "no" };
    const { bot, api } = botHarness({
      withdrawals: {
        execute: () =>
          Promise.resolve({
            status: "failed",
            wallet: MAIN_SUMMARY,
            withdrawal: testWithdrawal({
              status: "FAILED",
              signature: null,
              lamports: 625_000_000n,
            }),
            failure,
          }),
      },
    });
    await reachConfirm(bot);

    await feed(bot, callbackUpdate(confirmData(api)));
    expect(lastEdit(api)).toContain("❌ Withdrawal failed.");
    expect(lastEdit(api)).toContain("Reason: The network didn't confirm the transaction in time.");
    expect(lastEdit(api)).toContain("Nothing was sent.");

    await feed(bot, callbackUpdate(WITHDRAW_CB.tryAgain));
    expect(lastEdit(api)).toContain(HEADER_3);
    expect(confirmData(api)).toMatch(/^wal:wx:ok:[0-9a-f]{8}$/);
  });

  it("reads the chain before a Try again on an unknown outcome, and shows the success", async () => {
    const pending = testWithdrawal({ id: "wd9", status: "PENDING", lamports: 625_000_000n });
    // Nothing in flight at Confirm; the attempt of that Confirm landed by the time of Try again.
    const resolve = vi
      .fn<WithdrawalService["resolve"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ ...pending, status: "CONFIRMED" });
    const { bot, api, prisma } = botHarness({
      withdrawals: {
        execute: () =>
          Promise.resolve({
            status: "failed",
            wallet: MAIN_SUMMARY,
            withdrawal: pending,
            failure: {
              ok: false,
              code: "CONFIRMATION_UNKNOWN",
              landed: "unknown",
              signature: TEST_SIGNATURE,
            },
          }),
        resolve,
      },
    });
    await reachConfirm(bot);

    await feed(bot, callbackUpdate(confirmData(api)));
    expect(lastEdit(api)).not.toContain("Nothing was sent.");
    expect(lastEdit(api)).toContain(`?cluster=devnet">5KtP…x9Qm</a>`);

    await feed(bot, callbackUpdate(WITHDRAW_CB.tryAgain));
    expect(resolve).toHaveBeenLastCalledWith(TEST_USER.id, "w1");
    expect(lastEdit(api)).toContain("✅ Withdrawal sent.");
    expect(storedSession(prisma)?.withdraw).toBeUndefined();
  });

  it("warns on Try again while the previous attempt may still land", async () => {
    const pending = testWithdrawal({ id: "wd9", status: "PENDING" });
    const resolve = vi
      .fn<WithdrawalService["resolve"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(pending);
    const { bot, api } = botHarness({
      withdrawals: {
        execute: () =>
          Promise.resolve({
            status: "failed",
            wallet: MAIN_SUMMARY,
            withdrawal: pending,
            failure: { ok: false, code: "CONFIRMATION_UNKNOWN", landed: "unknown" },
          }),
        resolve,
      },
    });
    await reachConfirm(bot);
    await feed(bot, callbackUpdate(confirmData(api)));

    await feed(bot, callbackUpdate(WITHDRAW_CB.tryAgain));

    expect(lastEdit(api)).toContain(HEADER_3);
    expect(lastEdit(api)).toContain(
      "⚠️ A previous attempt may still go through. Check the explorer first.",
    );
  });

  it("opens Withdraw all from the blocking with Max chosen: address, then confirmation", async () => {
    const execute = vi.fn(fakeWithdrawals().execute);
    const { bot, api, prisma } = botHarness({ withdrawals: { execute } });

    await open(bot, "max");
    expect(lastEdit(api)).toContain("STEP 1/2");
    expect(lastEdit(api)).toContain("💰 Amount: Max (balance − fees)");

    await feed(bot, textUpdate(TO));
    expect(lastEdit(api)).toContain("<b>📤 WITHDRAW · STEP 2/2</b>");
    expect(lastEdit(api)).toContain("💰 Amount: 2.499995 SOL ($258.40) (Max)");
    expect(storedSession(prisma)?.withdraw).toMatchObject({ mode: "all", amount: "max" });

    await feed(bot, callbackUpdate(confirmData(api)));
    expect(execute).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, "w1", TO, { kind: "max" });
    expect(lastEdit(api)).toContain("✅ Withdrawal sent.");
  });

  it("answers an old step button with the expired-button toast when no flow is open", async () => {
    const { bot, api } = botHarness();

    await feed(bot, callbackUpdate(WITHDRAW_CB.max));

    expect(alerts(api)).toContain(en.common.staleButton);
    expect(lastEdit(api)).toContain("<b>👛 WALLETS");
  });
});
