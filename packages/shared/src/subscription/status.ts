import { formatRemaining } from "../format/date.js";
import { en } from "../i18n/en.js";
import type { SubscriptionPeriod } from "./rules.js";

/**
 * The plan of a user, as the home screen (§4.3) and the offers screen (§8.2) show it: the
 * active subscription, the one that ended last (« Classic ⚠️ expired »), or none.
 */
export type PlanStatus =
  { kind: "NONE" } | { kind: "ACTIVE" | "EXPIRED"; subscription: SubscriptionPeriod };

/**
 * `Premium · 1d 4h left`, `Classic · until 12 Oct`, `Classic ⚠️ expired`; `null` without a
 * plan, which each screen words its own way. An active plan that ends before `now` reads
 * expired.
 */
export function planLabel(status: PlanStatus, now: Date): string | null {
  if (status.kind === "NONE") return null;
  const { plan, expiresAt } = status.subscription;
  const remaining = status.kind === "ACTIVE" ? formatRemaining(expiresAt, now) : null;
  return remaining === null
    ? en.planStatus.expired(en.plans[plan])
    : en.planStatus.active(en.plans[plan], remaining);
}
