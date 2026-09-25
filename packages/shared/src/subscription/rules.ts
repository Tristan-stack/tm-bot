import type { Duration, Plan } from "../constants.js";
import type { Offer } from "./offers.js";

/**
 * One continuous period of a plan, as the rules and the screens read it. The database row
 * (`SubscriptionInfo` of @launchbot/db) carries its id on top.
 */
export type SubscriptionPeriod = {
  plan: Plan;
  duration: Duration;
  startsAt: Date;
  expiresAt: Date;
};

/**
 * What buying a plan does (§8.4). Same plan, whatever the duration: the pass extends the
 * current one. Classic → Premium: Premium starts at once and the Classic time left is lost
 * (the screens warn first). Premium → Classic: only once Premium has ended.
 */
export type PurchaseDecision = "NEW" | "EXTEND" | "UPGRADE" | "REFUSED";

/** `current` must be the active subscription: a row whose end has passed is no subscription. */
export function decidePurchase(current: SubscriptionPeriod | null, plan: Plan): PurchaseDecision {
  if (current === null) return "NEW";
  if (current.plan === plan) return "EXTEND";
  return plan === "PREMIUM" ? "UPGRADE" : "REFUSED";
}

export const ACTIVATION_KINDS = ["NEW", "EXTEND", "UPGRADE", "EXTEND_PREMIUM"] as const;
export type ActivationKind = (typeof ACTIVATION_KINDS)[number];

/**
 * An activation from a paid invoice (`PAYMENT`) or by an admin (`GRANT`, /grant): the grant
 * refuses Classic during Premium like the screens do, a payment never loses the money it got.
 */
export type ActivationMode = "PAYMENT" | "GRANT";

export type ComputedActivation =
  { kind: ActivationKind; startsAt: Date; expiresAt: Date } | { kind: "REFUSED" };

const after = (date: Date, ms: number) => new Date(date.getTime() + ms);

/**
 * The period an activation at `now` gives. The time starts at the activation, not at the
 * invoice. An extension adds the pass to the current end, never to `now`. A Classic invoice
 * paid while a Premium became active in between (another invoice, /grant) extends the Premium
 * by the Classic time: `EXTEND_PREMIUM` (proposal validated on 24/09/2026).
 */
export function computeActivation(
  current: SubscriptionPeriod | null,
  offer: Offer,
  now: Date,
  mode: ActivationMode,
): ComputedActivation {
  const active = current !== null && current.expiresAt > now ? current : null;
  if (active === null) {
    return { kind: "NEW", startsAt: now, expiresAt: after(now, offer.durationMs) };
  }
  const extended = {
    startsAt: active.startsAt,
    expiresAt: after(active.expiresAt, offer.durationMs),
  };
  switch (decidePurchase(active, offer.plan)) {
    case "UPGRADE":
      return { kind: "UPGRADE", startsAt: now, expiresAt: after(now, offer.durationMs) };
    case "REFUSED":
      return mode === "PAYMENT" ? { kind: "EXTEND_PREMIUM", ...extended } : { kind: "REFUSED" };
    default:
      return { kind: "EXTEND", ...extended };
  }
}
