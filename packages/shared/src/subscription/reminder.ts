import { SUB_OPEN } from "../callback.js";
import { REMINDER_BEFORE_MS } from "../constants.js";
import type { Duration } from "../constants.js";
import { formatDateTime } from "../format/date.js";
import { en } from "../i18n/en.js";
import type { Ui } from "../ui/index.js";
import { cbBtn, renderScreen } from "../ui/screen.js";
import type { Screen } from "../ui/screen.js";
import type { SubscriptionPeriod } from "./rules.js";
import { planLabel } from "./status.js";

// The reminder before the end of a plan (§8.4, V1-34). When it is due is a query of
// `@launchbot/db` (`createReminderService`), which reads the notice here.

/** 24 h before the end, 6 h for a 2-day pass: the duration of the last pass bought (V1-27). */
export const reminderLeadMs = (duration: Duration): number => REMINDER_BEFORE_MS[duration];

/**
 * A new message of its own (the worker does not know the screen of the bot): the plan, its time
 * left as on the home screen (§4.3), its end in UTC, and Renew, which opens the offers (V1-29)
 * in place of the reminder.
 */
export function buildReminderScreen(ui: Ui, subscription: SubscriptionPeriod, now: Date): Screen {
  const texts = en.subscribe.reminder;
  const label = planLabel({ kind: "ACTIVE", subscription }, now) ?? en.plans[subscription.plan];
  return renderScreen({
    header: ui.screenHeader(texts.title),
    description: texts.description(en.plans[subscription.plan]),
    info: [texts.left(label), texts.ends(formatDateTime(subscription.expiresAt))],
    footer: texts.extends,
    keyboard: [[cbBtn(texts.btnRenew, SUB_OPEN)]],
  });
}
