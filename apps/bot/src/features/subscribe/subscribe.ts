import type { WalletPaymentService } from "@launchbot/db";
import { decidePurchase, en, isAiModelAvailable, parseOfferCode } from "@launchbot/shared";
import type { AiProviders, Offer, PlanStatus, Ui } from "@launchbot/shared";
import type { BotContext } from "../../context.js";
import { notify } from "../../navigation/notify.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { ShowResult } from "../../navigation/show-screen.js";
import type { CallbackHandler, CallbackRouter } from "../../router/callback-router.js";
import type { DataServices } from "../../services/data.js";
import { createInvoiceFlow } from "./invoice.js";
import type { InvoicePayments } from "./invoice.js";
import { createPayFromWallet } from "./pay.js";
import { buildOffersScreen, buildUpgradeScreen } from "./screens.js";
import type { OffersModel } from "./screens.js";

export type SubscribeDeps = {
  ui: Ui;
  /** Read on every click, never cached: the screen can be old, the plan has moved since. */
  data: Pick<DataServices, "getPlanStatus">;
  providers: AiProviders;
  /** The invoices of V1-28 (V1-30) and the payment from a bot wallet (V1-31). */
  payments: InvoicePayments;
  walletPayments: WalletPaymentService;
  now?: () => Date;
};

/** A click edits the message of its button: the menu, an invoice, the reminder (V1-34). */
export type OffersOptions = Pick<OffersModel, "flags">;

/** What the later tickets call: Launch Coin (V1-35). */
export type Subscribe = {
  showOffersScreen: (ctx: BotContext, options?: OffersOptions) => Promise<ShowResult>;
  /**
   * A click on an offer (§8.4), also « New invoice » of V1-30: the plan is read again, then
   * Classic during Premium is refused, Classic → Premium asks first, anything else invoices.
   */
  chooseOffer: (ctx: BotContext, offer: Offer) => Promise<unknown>;
  /** Continue on the warning: the rules are read again, the warning is not shown twice. */
  continueUpgrade: (ctx: BotContext, offer: Offer) => Promise<unknown>;
  /** The actions of the invoice (V1-30) and of Pay from my wallet (V1-31, `pw`). */
  handlers: Record<string, CallbackHandler>;
};

export function createSubscribe(deps: SubscribeDeps): Subscribe {
  const { ui, data, providers, payments, walletPayments, now = () => new Date() } = deps;

  const statusOf = (ctx: BotContext) => data.getPlanStatus(ctx.user.id);

  const showOffers = (ctx: BotContext, status: PlanStatus, options: OffersOptions = {}) =>
    showScreen(
      ctx,
      buildOffersScreen(ui, {
        ...options,
        status,
        aiModelAvailable: isAiModelAvailable(providers),
        now: now(),
      }),
    );
  const showOffersScreen: Subscribe["showOffersScreen"] = async (ctx, options) =>
    showOffers(ctx, await statusOf(ctx), options);

  const chooseOffer: Subscribe["chooseOffer"] = (ctx, offer) => decide(ctx, offer, true);
  const invoices = createInvoiceFlow({
    ui,
    payments,
    offers: { show: showOffersScreen, choose: chooseOffer },
    now,
  });

  /** `warn`: a Classic → Premium shows the warning (a click on an offer), or goes on (Continue). */
  async function decide(ctx: BotContext, offer: Offer, warn: boolean): Promise<unknown> {
    const status = await statusOf(ctx);
    const active = status.kind === "ACTIVE" ? status.subscription : null;
    const decision = decidePurchase(active, offer.plan);
    if (decision === "REFUSED") {
      // The offers screen already says it during Premium: an identical edit is ignored.
      await notify(ctx, en.subscribe.classicDuringPremium.alert, { alert: true });
      return showOffers(ctx, status);
    }
    if (decision === "UPGRADE" && warn) {
      return showScreen(ctx, buildUpgradeScreen(ui, { offer, status, now: now() }));
    }
    // NEW, EXTEND (the same plan again extends it), or an UPGRADE the user accepted. On
    // Continue, a Classic that ended since, or a Premium that started, has nothing to lose.
    return invoices.openInvoiceForOffer(ctx, offer);
  }

  return {
    showOffersScreen,
    chooseOffer,
    continueUpgrade: (ctx, offer) => decide(ctx, offer, false),
    handlers: { ...invoices.handlers, pw: createPayFromWallet({ ui, walletPayments, invoices }) },
  };
}

/** The `sub` domain: the offers (V1-29), the invoice (V1-30), Pay from my wallet (V1-31). */
export function registerSubscribe(router: CallbackRouter, subscribe: Subscribe): void {
  // An unknown offer code (an old button, a forged one) lands on the offers.
  const withOffer =
    (next: (ctx: BotContext, offer: Offer) => Promise<unknown>): CallbackHandler =>
    (ctx, [code]) => {
      const offer = code === undefined ? null : parseOfferCode(code);
      return offer === null ? subscribe.showOffersScreen(ctx) : next(ctx, offer);
    };

  router.register("sub", {
    open: (ctx) => subscribe.showOffersScreen(ctx),
    buy: withOffer(subscribe.chooseOffer),
    up: withOffer(subscribe.continueUpgrade),
    ...subscribe.handlers,
  });
}
