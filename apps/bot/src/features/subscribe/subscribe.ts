import { decidePurchase, en, isAiModelAvailable, parseOfferCode } from "@launchbot/shared";
import type { AiProviders, Offer, PlanStatus, Ui } from "@launchbot/shared";
import type { BotContext } from "../../context.js";
import { notify } from "../../navigation/notify.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { ShowMode, ShowResult } from "../../navigation/show-screen.js";
import type { CallbackHandler, CallbackRouter } from "../../router/callback-router.js";
import type { DataServices } from "../../services/data.js";
import { buildInvoiceSoonScreen, buildOffersScreen, buildUpgradeScreen } from "./screens.js";
import type { OffersModel } from "./screens.js";

export type SubscribeDeps = {
  ui: Ui;
  /** Read on every click, never cached: the screen can be old, the plan has moved since. */
  data: Pick<DataServices, "getPlanStatus">;
  providers: AiProviders;
  now?: () => Date;
};

/** `mode: "new"` for a message of its own (Renew from a reminder, V1-34). */
export type OffersOptions = Pick<OffersModel, "flags"> & { mode?: ShowMode };

/** What the later tickets call: the invoice (V1-30), Renew (V1-34), Launch Coin (V1-35). */
export type Subscribe = {
  showOffersScreen: (ctx: BotContext, options?: OffersOptions) => Promise<ShowResult>;
  /**
   * A click on an offer (§8.4), also « New invoice » of V1-30: the plan is read again, then
   * Classic during Premium is refused, Classic → Premium asks first, anything else invoices.
   */
  chooseOffer: (ctx: BotContext, offer: Offer) => Promise<unknown>;
  /** Continue on the warning: the rules are read again, the warning is not shown twice. */
  continueUpgrade: (ctx: BotContext, offer: Offer) => Promise<unknown>;
  /** The rules are passed: never shows the warning. Provisional until V1-30. */
  openInvoiceForOffer: (ctx: BotContext, offer: Offer) => Promise<unknown>;
};

export function createSubscribe(deps: SubscribeDeps): Subscribe {
  const { ui, data, providers, now = () => new Date() } = deps;

  const statusOf = (ctx: BotContext) => data.getPlanStatus(ctx.user.id);

  const showOffers = (ctx: BotContext, status: PlanStatus, options: OffersOptions = {}) => {
    const { mode, ...rest } = options;
    const screen = buildOffersScreen(ui, {
      ...rest,
      status,
      aiModelAvailable: isAiModelAvailable(providers),
      now: now(),
    });
    return showScreen(ctx, screen, { mode });
  };

  const openInvoiceForOffer: Subscribe["openInvoiceForOffer"] = (ctx, offer) =>
    showScreen(ctx, buildInvoiceSoonScreen(ui, offer));

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
    return openInvoiceForOffer(ctx, offer);
  }

  return {
    showOffersScreen: async (ctx, options) => showOffers(ctx, await statusOf(ctx), options),
    chooseOffer: (ctx, offer) => decide(ctx, offer, true),
    continueUpgrade: (ctx, offer) => decide(ctx, offer, false),
    openInvoiceForOffer,
  };
}

/** The `sub` domain: the offers (V1-29). V1-30 and V1-31 add their actions here. */
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
  });
}
