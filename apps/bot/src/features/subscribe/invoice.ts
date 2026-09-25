import type { InvoiceCheck, PaymentService } from "@launchbot/db";
import { buildPaymentReceivedScreen, createTtlCache, en, RATE_LIMITS } from "@launchbot/shared";
import type { Offer, OptionalLine, Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { BotContext } from "../../context.js";
import { notify } from "../../navigation/notify.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { Block, ShowResult } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import { buildInvoiceExpiredScreen, buildInvoiceScreen } from "./invoice-screens.js";
import type { InvoiceModel } from "./invoice-screens.js";

const log = createLogger("bot:invoice");

const { invoice: texts } = en.subscribe;

/** The « I've paid » answers kept at once (proposal): far more than 5 s of clicks. */
const RECENT_CHECKS_MAX = 1_000;

export type InvoicePayments = Pick<
  PaymentService,
  "createInvoice" | "getInvoice" | "checkInvoice" | "cancelInvoice"
>;

export type InvoiceFlowDeps = {
  ui: Ui;
  payments: InvoicePayments;
  /** The offers of V1-29: where an invoice that cannot be shown leads, and New invoice. */
  offers: {
    show: (ctx: BotContext, options?: { flags?: OptionalLine[] }) => Promise<unknown>;
    choose: (ctx: BotContext, offer: Offer) => Promise<unknown>;
  };
  now: () => Date;
};

/**
 * The invoice (§8.3, V1-30): no session, the id travels in the callback data and the invoice
 * is read again at every click, from the table or from the chain.
 */
export function createInvoiceFlow(deps: InvoiceFlowDeps) {
  const { ui, payments, offers, now } = deps;

  /**
   * « I've paid » reads the chain at most once per invoice every 5 s (proposal, D17): a click
   * sooner gets the same answer, from memory. Keyed by user too: the check proves ownership.
   */
  const recentChecks = createTtlCache<string, InvoiceCheck>({
    ttlMs: RATE_LIMITS.paymentCheck.windowMs,
    // Only evicted by count: a memo of 5 s needs the last clicks, not one entry per invoice ever.
    maxEntries: RECENT_CHECKS_MAX,
    now: () => now().getTime(),
  });
  const checkKey = (ctx: BotContext, paymentId: string) => `${ctx.user.id}:${paymentId}`;

  /** A blocked click answered on the offers (§4.5): the alert, then the offers with the line. */
  async function blockOnOffers(ctx: BotContext, block: Block): Promise<unknown> {
    await notify(ctx, block.alert, { alert: true });
    return offers.show(ctx, { flags: [block.flag] });
  }

  /** Unknown, someone else's, or of a purged account: the same answer, nothing more is said. */
  const notFound = (ctx: BotContext) => blockOnOffers(ctx, texts.notFound);

  const showInvoice = (ctx: BotContext, model: InvoiceModel): Promise<ShowResult> =>
    showScreen(ctx, buildInvoiceScreen(ui, model));

  /**
   * Where a check leaves the user (§8.3): the invoice still waiting, with the last check or the
   * payment sent from a wallet (V1-31), the plan it paid for, how it ended, or the offers.
   * « Payment received » is shown whoever activated: the worker (V1-32) sends its own message
   * only when it did.
   */
  function presentCheck(
    ctx: BotContext,
    check: InvoiceCheck,
    options: { sent?: boolean } = {},
  ): Promise<unknown> {
    switch (check.kind) {
      case "NOT_DETECTED":
      case "PARTIAL":
        return showInvoice(ctx, {
          invoice: check.invoice,
          line:
            options.sent === true
              ? { kind: "PAYMENT_SENT" }
              : { kind: "LAST_CHECK", at: check.checkedAt },
        });
      case "ACTIVATED":
        return showScreen(ctx, buildPaymentReceivedScreen(ui, check));
      case "EXPIRED":
      case "PARTIAL_EXPIRED":
      case "LATE_FULL_PAYMENT":
        return showScreen(ctx, buildInvoiceExpiredScreen(ui, check.invoice, check.kind));
      case "CANCELED":
        return offers.show(ctx);
      case "ORPHAN_PAYMENT":
      case "NOT_FOUND":
        return notFound(ctx);
    }
  }

  /**
   * The invoice as the table has it (V1-31 comes back here): a pending one is drawn with its
   * line, any other goes through a check, which says how it ended.
   */
  async function showInvoiceScreen(
    ctx: BotContext,
    paymentId: string,
    options: { flags?: OptionalLine[] } = {},
  ): Promise<unknown> {
    const at = now();
    const invoice = await payments.getInvoice(paymentId, ctx.user.id, at);
    if (invoice === null) return notFound(ctx);
    if (invoice.status !== "PENDING") {
      return presentCheck(
        ctx,
        await payments.checkInvoice(paymentId, { now: at, userId: ctx.user.id }),
      );
    }
    return showInvoice(ctx, { invoice, line: { kind: "WAITING" }, flags: options.flags });
  }

  /** Once the rules of V1-27 are passed (a click on an offer, Continue, New invoice). */
  async function openInvoiceForOffer(ctx: BotContext, offer: Offer): Promise<unknown> {
    const result = await payments.createInvoice({ userId: ctx.user.id, offer, now: now() });
    if (result.ok) return showInvoice(ctx, { invoice: result.invoice, line: { kind: "WAITING" } });
    switch (result.error) {
      case "PRICE_UNAVAILABLE":
        return blockOnOffers(ctx, texts.priceUnavailable);
      case "RATE_LIMITED":
        return blockOnOffers(ctx, texts.tooManyInvoices);
      case "PLAN_SWITCH_REFUSED":
        // The offers screen says it on its Classic line for as long as Premium is active.
        await notify(ctx, en.subscribe.classicDuringPremium.alert, { alert: true });
        return offers.show(ctx);
    }
  }

  /** « I've paid »: one fresh read of the deposit, or the answer of the last 5 seconds. */
  async function paid(ctx: BotContext, paymentId: string): Promise<unknown> {
    let check: InvoiceCheck;
    try {
      check = await recentChecks.get(checkKey(ctx, paymentId), () =>
        payments.checkInvoice(paymentId, { now: now(), userId: ctx.user.id }),
      );
    } catch (error) {
      // The RPC did not answer: the invoice stays, and says so (§4.5).
      log.warn({ err: error, paymentId }, "invoice.check_failed");
      await notify(ctx, texts.checkFailed.alert, { alert: true });
      return showInvoiceScreen(ctx, paymentId, { flags: [texts.checkFailed.flag] });
    }
    // The toast of the click; the screen says the same with its status line (§4.5). Same
    // minute, same text: Telegram refuses the edit, and the toast has said it.
    if (check.kind === "NOT_DETECTED") await notify(ctx, texts.notDetected);
    if (check.kind === "PARTIAL") await notify(ctx, texts.partialDetected);
    return presentCheck(ctx, check);
  }

  async function cancel(ctx: BotContext, paymentId: string): Promise<unknown> {
    const at = now();
    recentChecks.delete(checkKey(ctx, paymentId));
    switch (await payments.cancelInvoice(paymentId, ctx.user.id, at)) {
      case "CANCELED":
      case "NOOP":
        return offers.show(ctx);
      case "ALREADY_PAID":
        // A paid invoice is not read on the chain: the check gives the plan it paid for.
        return presentCheck(
          ctx,
          await payments.checkInvoice(paymentId, { now: at, userId: ctx.user.id }),
        );
      case "NOT_FOUND":
        return notFound(ctx);
    }
  }

  /** New invoice (§8.3): the same offer through the rules again, at the price of now. */
  async function renew(ctx: BotContext, paymentId: string): Promise<unknown> {
    const invoice = await payments.getInvoice(paymentId, ctx.user.id, now());
    return invoice === null ? notFound(ctx) : offers.choose(ctx, invoice.offer);
  }

  /** An id that is not there is an unknown invoice: `find` of V1-28 checks its format. */
  const withId =
    (next: (ctx: BotContext, paymentId: string) => Promise<unknown>): CallbackHandler =>
    (ctx, [paymentId]) =>
      next(ctx, paymentId ?? "");

  const handlers: Record<string, CallbackHandler> = {
    inv: withId(showInvoiceScreen),
    paid: withId(paid),
    cancel: withId(cancel),
    new: withId(renew),
  };

  return {
    openInvoiceForOffer,
    showInvoiceScreen,
    presentCheck,
    showOffers: (ctx: BotContext) => offers.show(ctx),
    handlers,
  };
}

export type InvoiceFlow = ReturnType<typeof createInvoiceFlow>;
