import { z } from "zod";
import { DURATIONS, PLAN_DURATION_MS, PLANS, PRICES_USD } from "../constants.js";
import type { Duration, Plan } from "../constants.js";

/** The short code of an offer in callback data (`sub:buy:P2D`, V1-29). */
export const OFFER_CODES = ["C2D", "C1M", "P2D", "P1M"] as const;
export type OfferCode = (typeof OFFER_CODES)[number];

const OFFER_CODE = {
  CLASSIC: { TWO_DAYS: "C2D", ONE_MONTH: "C1M" },
  PREMIUM: { TWO_DAYS: "P2D", ONE_MONTH: "P1M" },
} as const satisfies Record<Plan, Record<Duration, OfferCode>>;

/** One of the 4 passes of §8.1: priced in USD, paid in SOL at the rate of the moment. */
export type Offer = {
  code: OfferCode;
  plan: Plan;
  duration: Duration;
  priceUsdCents: number;
  /** 48 h, or 30 days exactly (never a calendar month). */
  durationMs: number;
};

/** Display order of the offers screen: Classic 2 days, Classic 1 month, then Premium. */
const OFFERS: readonly Offer[] = PLANS.flatMap((plan) =>
  DURATIONS.map((duration) => ({
    code: OFFER_CODE[plan][duration],
    plan,
    duration,
    priceUsdCents: PRICES_USD[plan][duration] * 100,
    durationMs: PLAN_DURATION_MS[duration],
  })),
);

export const listOffers = (): readonly Offer[] => OFFERS;

export function getOffer(plan: Plan, duration: Duration): Offer {
  const offer = OFFERS.find((item) => item.plan === plan && item.duration === duration);
  if (offer === undefined) throw new Error(`No offer for ${plan} ${duration}`);
  return offer;
}

const offerCodeSchema = z.enum(OFFER_CODES);

/** The offer of a callback argument, or `null` for anything else. */
export function parseOfferCode(code: string): Offer | null {
  const parsed = offerCodeSchema.safeParse(code);
  return parsed.success ? (OFFERS.find((offer) => offer.code === parsed.data) ?? null) : null;
}
