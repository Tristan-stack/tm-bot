import type { PayChoices, PayOutcome, PayQuote, WalletPaymentService } from "@launchbot/db";
import { en } from "@launchbot/shared";
import type { Ui } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import type { BotContext, PayState } from "../../context.js";
import { newConfirmToken } from "../../navigation/confirm-token.js";
import { acknowledge, notify } from "../../navigation/notify.js";
import { presentScreen, showScreen } from "../../navigation/show-screen.js";
import type { PresentOptions } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import type { InvoiceFlow } from "./invoice.js";
import {
  buildPayChoicesScreen,
  buildPayConfirmScreen,
  buildPayFailureScreen,
  buildPaySendingScreen,
  insufficientBlock,
} from "./pay-screens.js";

const { confirm: texts } = en.subscribe.payFromWallet;

type Options = Pick<PresentOptions, "flags" | "block">;

export type PayFlowDeps = {
  ui: Ui;
  walletPayments: WalletPaymentService;
  invoices: InvoiceFlow;
};

/** What a click on a wallet, or a Confirm, cannot go on with. */
type Refused = Exclude<PayOutcome, { status: "sent" | "unconfirmed" | "failed" | "locked" }>;

/**
 * Pay from my wallet (§8.3, V1-31): a wallet of the bot pays the rest of an invoice to its
 * deposit address. The rules and the send live in the service; here, the screens and the
 * session, which holds ids only. Returns the handler of `sub:pw:<step>`.
 */
export function createPayFromWallet(deps: PayFlowDeps): CallbackHandler {
  const { ui, walletPayments: service, invoices } = deps;

  const showChoices = (ctx: BotContext, choices: PayChoices, options: Options = {}) =>
    presentScreen(ctx, (flags) => buildPayChoicesScreen(ui, choices, { flags }), options);

  /** The session of this invoice: a send still unknown is kept across a new choice. */
  function stateFor(ctx: BotContext, paymentId: string): PayState {
    const previous = ctx.session.pay;
    const state: PayState = { paymentId };
    if (previous?.paymentId === paymentId && previous.sent !== undefined) {
      state.sent = previous.sent;
    }
    ctx.session.pay = state;
    return state;
  }

  /** `sub:pw:open:<id>`: the button of the invoice (V1-30). */
  async function open(ctx: BotContext, paymentId: string): Promise<unknown> {
    const result = await service.listChoices(ctx.user.id, paymentId);
    if (result.status === "blocked") return invoices.presentCheck(ctx, result.check);
    stateFor(ctx, paymentId);
    return showChoices(ctx, result);
  }

  const showConfirm = (ctx: BotContext, quote: PayQuote, options: Options = {}) => {
    const token = newConfirmToken();
    stateFor(ctx, quote.invoice.id).confirm = {
      walletId: quote.wallet.id,
      amount: quote.invoice.remainingLamports.toString(),
      token,
    };
    return presentScreen(
      ctx,
      (flags) => buildPayConfirmScreen(ui, quote, token, { flags }),
      options,
    );
  };

  /** Said on the screen it comes from; a wallet that cannot pay redraws the list it came with. */
  function answer(ctx: BotContext, outcome: Refused): Promise<unknown> {
    switch (outcome.status) {
      case "blocked":
        return invoices.presentCheck(ctx, outcome.check);
      case "insufficient":
        return showChoices(ctx, outcome, {
          block: insufficientBlock(outcome.invoice, outcome.wallet, outcome.missingLamports),
        });
      case "wallet_not_found":
        return showChoices(ctx, outcome, { block: en.wallets.notFound });
      case "balance_unavailable":
        return showChoices(ctx, outcome, { block: en.wallets.delete.checkFailed });
      case "amount_changed":
        return showConfirm(ctx, outcome, { block: texts.amountUpdated });
    }
  }

  /** A click on a wallet (§8.3): its balance read this very moment, then Confirm or the note. */
  async function chooseWallet(
    ctx: BotContext,
    paymentId: string,
    walletId: string,
    options: Options = {},
  ): Promise<unknown> {
    const result = await service.quote(ctx.user.id, paymentId, walletId);
    return result.status === "ok" ? showConfirm(ctx, result, options) : answer(ctx, result);
  }

  /** An old button of a flow that is over: the toast, then the invoice or the offers. */
  async function stale(ctx: BotContext): Promise<unknown> {
    await notify(ctx, en.common.staleButton);
    const paymentId = ctx.session.pay?.paymentId;
    return paymentId === undefined
      ? invoices.showOffers(ctx)
      : invoices.showInvoiceScreen(ctx, paymentId);
  }

  /**
   * Confirm (§8.3): the cheap refusal first, with its alert, then the query is answered, and
   * the service locks the invoice, checks it all again and sends. The token of the button is
   * spent before: a second click on the same screen is a stale button, not a second send.
   */
  async function confirm(ctx: BotContext, token: string | undefined): Promise<unknown> {
    const state = ctx.session.pay;
    const shown = state?.confirm;
    if (state === undefined || shown?.token === undefined || token !== shown.token) {
      return stale(ctx);
    }
    const { paymentId } = state;
    if (!consumeRateLimit(Number(ctx.user.telegramId), "payFromWallet").ok) {
      return chooseWallet(ctx, paymentId, shown.walletId, { block: texts.tooMany });
    }
    delete shown.token;
    await acknowledge(ctx);

    const outcome = await service.pay(
      ctx.user.id,
      { paymentId, walletId: shown.walletId, amountLamports: BigInt(shown.amount) },
      {
        inFlight: state.sent,
        onSending: (quote) => showScreen(ctx, buildPaySendingScreen(ui, quote)),
      },
    );
    if (outcome.status !== "unconfirmed") delete state.sent;
    switch (outcome.status) {
      case "sent":
        return invoices.presentCheck(ctx, outcome.check, { sent: true });
      case "unconfirmed":
        // The SOL may still arrive: no failure, no Try again, the invoice says it was sent.
        if (outcome.signature !== undefined) {
          state.sent = { signature: outcome.signature, sentAt: Date.now() };
        }
        return invoices.presentCheck(ctx, outcome.check, { sent: true });
      case "failed":
        return showScreen(
          ctx,
          buildPayFailureScreen(ui, {
            paymentId,
            wallet: outcome.wallet,
            failure: outcome.failure,
          }),
        );
      case "locked":
        // Answered already: the line alone says it (§4.5).
        return chooseWallet(ctx, paymentId, shown.walletId, { flags: [texts.locked.flag] });
      default:
        return answer(ctx, outcome);
    }
  }

  return (ctx, [step, first, second]) => {
    switch (step) {
      case "open":
        return open(ctx, first ?? "");
      case "w":
        return chooseWallet(ctx, first ?? "", second ?? "");
      case "ok":
        return confirm(ctx, first);
      case "re": {
        // Try again: the confirmation computed again, the rest and the fees of now.
        const state = ctx.session.pay;
        return state?.confirm === undefined
          ? stale(ctx)
          : chooseWallet(ctx, state.paymentId, state.confirm.walletId);
      }
      default:
        return invoices.showOffers(ctx);
    }
  };
}
