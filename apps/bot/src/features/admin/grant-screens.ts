import type { GrantPreview } from "@launchbot/db";
import {
  adminUserText,
  cbBtn,
  en,
  formatDateTime,
  getOffer,
  LAUNCH_COIN,
  NAV_HOME,
  planLabel,
  renderScreen,
} from "@launchbot/shared";
import type { AdminUser, Offer, Plan, Screen, Ui } from "@launchbot/shared";
import { z } from "zod";
import { ADMIN_CB, adminHeader, offerLabel, userArg } from "./common.js";

// /grant (§8.4, §11.4, V1-42): the syntax, the confirmation and its four variants, the result.

const PLAN_ARGS = { classic: "CLASSIC", premium: "PREMIUM" } as const;
const DURATION_ARGS = { "2d": "TWO_DAYS", "1m": "ONE_MONTH" } as const;
const lower = z.string().transform((word) => word.toLowerCase());

/** `/grant <id or support code> <classic|premium> <2d|1m>`, case ignored (proposal). */
export const grantArgsSchema = z
  .tuple([userArg, lower.pipe(z.enum(["classic", "premium"])), lower.pipe(z.enum(["2d", "1m"]))])
  .transform(([user, plan, duration]) => ({
    ...user,
    offer: getOffer(PLAN_ARGS[plan], DURATION_ARGS[duration]),
  }));

export type GrantConfirmModel = {
  user: AdminUser;
  offer: Offer;
  /** `previewGrant` of V1-27: the plan now and what the grant makes of it. */
  preview: GrantPreview;
  now: Date;
  nonce: string;
};

/** The flag of a variant: what the grant changes on top of the end date (§8.4). */
function variantFlag({ offer, preview }: GrantConfirmModel): string | undefined {
  const { computed, status } = preview;
  switch (computed.kind) {
    case "EXTEND":
      return en.admin.grant.extends(en.plans[offer.plan], en.durations[offer.duration]);
    case "UPGRADE":
      return en.admin.grant.upgradeLoss;
    case "REFUSED":
      return status.kind === "ACTIVE"
        ? en.admin.grant.premiumActive(formatDateTime(status.subscription.expiresAt))
        : undefined;
    default:
      return undefined;
  }
}

/**
 * The confirmation (§11.4): the question, the current plan as the offers screen says it, the end
 * the grant gives. Classic during Premium is refused as on the offers screen: its end is not
 * shown and Cancel is the only button.
 */
export function buildGrantConfirmScreen(ui: Ui, model: GrantConfirmModel): Screen {
  const { user, offer, preview, now, nonce } = model;
  const { computed, status } = preview;
  const cancel = cbBtn(en.btn.cancel, ADMIN_CB.grantCancel(nonce));
  return renderScreen({
    header: adminHeader(ui, "grant"),
    description: en.admin.grant.question(offerLabel(offer), adminUserText(user)),
    info: [
      en.admin.grant.currentPlan(planLabel(status, now) ?? en.subscribe.noPlan),
      ...(computed.kind === "REFUSED"
        ? []
        : [en.admin.grant.ends(formatDateTime(computed.expiresAt))]),
    ],
    flags: [variantFlag(model)],
    keyboard:
      computed.kind === "REFUSED"
        ? [[cancel]]
        : [[cbBtn(en.btn.confirm, ADMIN_CB.grantConfirm(nonce)), cancel]],
  });
}

/** The result, without a keyboard: the end of the plan activated, read from its row. */
export function buildGrantResultScreen(
  ui: Ui,
  model: { user: AdminUser; offer: Offer; expiresAt: Date; notified?: boolean },
): Screen {
  const { user, offer, expiresAt, notified } = model;
  return renderScreen({
    header: adminHeader(ui, "grant"),
    info: [
      en.admin.grant.done(en.plans[offer.plan], formatDateTime(expiresAt)),
      en.admin.grant.grantedTo(adminUserText(user), offerLabel(offer)),
    ],
    flags: [notified === false && en.admin.common.notNotified],
    keyboard: [],
  });
}

/** The message to the user (`GRANT_NOTIFY_USER`, proposal): « Payment received » without a payment. */
export function buildGrantNoticeScreen(ui: Ui, plan: Plan, expiresAt: Date): Screen {
  return renderScreen({
    header: ui.screenHeader(en.subscribe.title),
    info: en.admin.grant.notice(en.plans[plan], formatDateTime(expiresAt)),
    keyboard: [[cbBtn(en.menu.launchCoin, LAUNCH_COIN), cbBtn(en.btn.menu, NAV_HOME)]],
  });
}
