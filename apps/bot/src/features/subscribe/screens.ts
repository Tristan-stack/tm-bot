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

/** Callback data of the `sub` domain (V1-29). The offer travels in the data: no session. */
export const SUB_CB = {
  /** Also the Subscribe button of the main menu, Cancel of the warning and Back of an offer. */
  open: encodeCallback("sub", "open"),
  buy: (code: OfferCode) => encodeCallback("sub", "buy", code),
  /** Continue on the warning: the move from Classic to Premium is accepted. */
  upgrade: (code: OfferCode) => encodeCallback("sub", "up", code),
} as const;

/** `$49`: whole dollars on the offers screen, `$59.00` on the invoice (V1-30). */
const priceOf = (offer: Offer) => formatUsd(offer.priceUsdCents / 100, { decimals: 0 });

const offerText = (offer: Offer) =>
  en.subscribe.offer(en.plans[offer.plan], en.durations[offer.duration], priceOf(offer));

const offerHeader = (ui: Ui, offer: Offer) =>
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

/** Provisional: the invoice of an offer arrives with V1-30. */
export function buildInvoiceSoonScreen(ui: Ui, offer: Offer): Screen {
  return renderScreen({
    header: offerHeader(ui, offer),
    description: en.subscribe.invoiceSoon.description,
    info: en.subscribe.invoiceSoon.plan(planEmoji(offer.plan), offerText(offer)),
    flags: [en.subscribe.invoiceSoon.flag],
    keyboard: [navRow(SUB_CB.open, { menu: true })],
  });
}
