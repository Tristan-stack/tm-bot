import {
  cbBtn,
  decidePurchase,
  en,
  encodeCallback,
  formatUsd,
  getPlanFeatures,
  listOffers,
  NAV_HOME,
  navRow,
  planLabel,
  renderScreen,
  tree,
} from "@launchbot/shared";
import type {
  Offer,
  OfferCode,
  OptionalLine,
  Plan,
  PlanStatus,
  Screen,
  Ui,
} from "@launchbot/shared";

/**
 * Callback data of the `sub` domain. The offer (V1-29) and the invoice (V1-30) travel in the
 * data, so a button works whatever the session holds; the invoice is read again at each click.
 */
export const SUB_CB = {
  /** Also the Subscribe button of the main menu, Cancel of the warning and Back of an offer. */
  open: encodeCallback("sub", "open"),
  buy: (code: OfferCode) => encodeCallback("sub", "buy", code),
  /** Continue on the warning: the move from Classic to Premium is accepted. */
  upgrade: (code: OfferCode) => encodeCallback("sub", "up", code),
  /** The invoice again, read from the database: Cancel and Back of the screens of V1-31. */
  invoice: (paymentId: string) => encodeCallback("sub", "inv", paymentId),
  paid: (paymentId: string) => encodeCallback("sub", "paid", paymentId),
  cancel: (paymentId: string) => encodeCallback("sub", "cancel", paymentId),
  /** New invoice for the same offer, from an expired one. */
  renew: (paymentId: string) => encodeCallback("sub", "new", paymentId),
  /** Pay from my wallet (V1-31): the entry of the steps `sub:pw:<step>` of `PAY_CB`. */
  payFromWallet: (paymentId: string) => encodeCallback("sub", "pw", "open", paymentId),
} as const;

/** `$49`: whole dollars on the offers screen, `$59.00` on the invoice (V1-30). */
const priceOf = (offer: Offer) => formatUsd(offer.priceUsdCents / 100, { decimals: 0 });

const offerText = (offer: Offer) =>
  en.subscribe.offer(en.plans[offer.plan], en.durations[offer.duration], priceOf(offer));

/** `⭐ PREMIUM · 2 DAYS`: the warning and every screen of an invoice (V1-30). */
export const offerHeader = (ui: Ui, offer: Offer) =>
  ui.screenHeader(en.subscribe.offerTitle(en.plans[offer.plan], en.durations[offer.duration]));

const planEmoji = (plan: Plan) => en.subscribe.planEmoji[plan];

/** The label of the home screen (§4.3), `None` without a plan. */
const planText = (status: PlanStatus, now: Date): string =>
  planLabel(status, now) ?? en.subscribe.noPlan;

/** §8.4: Classic cannot be bought now, the rule of the click itself. */
const classicRefused = (status: PlanStatus): boolean =>
  status.kind === "ACTIVE" && decidePurchase(status.subscription, "CLASSIC") === "REFUSED";

export type OffersModel = {
  status: PlanStatus;
  /** `isAiModelAvailable(providers)` (V1-17): drops the « coming soon » of the AI line. */
  aiModelAvailable: boolean;
  /**
   * Flags of the callers, right above the keyboard: payments unavailable (V1-30), the note
   * `en.subscribe.launchCoinNeedsPlan` of the Launch Coin entry (V1-35).
   */
  flags?: OptionalLine[];
  now: Date;
};

/** The offers screen (§8.2): the current plan, the 4 passes, what Premium adds. */
export function buildOffersScreen(ui: Ui, model: OffersModel): Screen {
  const offers = listOffers();
  const ofPlan = (plan: Plan) => offers.filter((offer) => offer.plan === plan);
  const passes = (plan: Plan) =>
    ofPlan(plan).map((offer) => en.subscribe.pass(en.durations[offer.duration], priceOf(offer)));
  const button = (offer: Offer) =>
    cbBtn(
      en.subscribe.offerButton(
        planEmoji(offer.plan),
        en.plans[offer.plan],
        en.durations[offer.duration],
      ),
      SUB_CB.buy(offer.code),
    );
  const premiumAdds = [
    en.subscribe.premiumAdds,
    en.subscribe.aiGenerator(model.aiModelAvailable),
    en.subscribe.upToWallets(getPlanFeatures("PREMIUM").maxWallets),
    en.subscribe.prioritySupport,
  ].join("\n");

  return renderScreen({
    header: ui.screenHeader(en.subscribe.title),
    description: en.subscribe.description,
    info: [
      en.subscribe.currentPlan(planText(model.status, model.now)),
      tree(en.subscribe.classic, passes("CLASSIC")),
      tree(en.subscribe.premium, passes("PREMIUM")),
      premiumAdds,
    ].join("\n\n"),
    flags: [
      classicRefused(model.status) && en.subscribe.classicDuringPremium.flag,
      ...(model.flags ?? []),
    ],
    keyboard: [ofPlan("CLASSIC").map(button), ofPlan("PREMIUM").map(button), navRow(NAV_HOME)],
  });
}

/** §8.4: before an invoice for Premium during a Classic, the time lost is said, then asked. */
export function buildUpgradeScreen(
  ui: Ui,
  model: { offer: Offer; status: PlanStatus; now: Date },
): Screen {
  const { offer } = model;
  return renderScreen({
    header: offerHeader(ui, offer),
    // The mockup opens on the warning.
    order: ["flags", "description", "info"],
    flags: [en.subscribe.upgrade.warning],
    description: en.subscribe.upgrade.description,
    info: [
      en.subscribe.currentPlan(planText(model.status, model.now)),
      en.subscribe.upgrade.newPlan(planEmoji(offer.plan), offerText(offer)),
    ],
    keyboard: [
      [cbBtn(en.btn.continue, SUB_CB.upgrade(offer.code)), cbBtn(en.btn.cancel, SUB_CB.open)],
    ],
  });
}
