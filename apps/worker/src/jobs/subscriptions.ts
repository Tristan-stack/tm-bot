import type { ReminderService, SubscriptionService } from "@launchbot/db";
import { buildReminderScreen } from "@launchbot/shared";
import type { Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { isUndeliverable } from "../telegram.js";
import type { TelegramSender } from "../telegram.js";

const log = createLogger("worker:subscriptions");

export type SubscriptionJobsDeps = {
  reminders: ReminderService;
  subscriptions: Pick<SubscriptionService, "expireDueSubscriptions">;
  telegram: Pick<TelegramSender, "sendScreen">;
  ui: Ui;
  now: () => Date;
};

/** The two crons of the plans (§8.4, V1-34). */
export function createSubscriptionJobs(deps: SubscriptionJobsDeps) {
  const { reminders, subscriptions, telegram, ui, now } = deps;

  return {
    /**
     * `subscriptions.remind`, every minute: a batch of the closest ends, sent one by one. Each
     * reminder is claimed before its send; a failure that may pass arms it again for the next
     * run, a user who blocked the bot keeps it spent.
     */
    remind: async (): Promise<{ due: number; sent: number }> => {
      const at = now();
      const due = await reminders.listDue(at);
      let sent = 0;
      for (const reminder of due) {
        if (!(await reminders.claim(reminder, at))) continue;
        // The time left of the moment of the send.
        const result = await telegram.sendScreen(
          reminder.telegramId,
          buildReminderScreen(ui, reminder, now()),
        );
        if (result.ok) {
          sent += 1;
        } else if (!isUndeliverable(result.reason)) {
          await reminders.release(reminder);
        }
      }
      if (sent > 0) log.info({ sent }, "subscription.reminders_sent");
      return { due: due.length, sent };
    },

    /** `subscriptions.expire`, every minute: ACTIVE rows past their end → EXPIRED, no message. */
    expire: async (): Promise<number> => {
      const expired = await subscriptions.expireDueSubscriptions(now());
      if (expired.length > 0) log.info({ count: expired.length }, "subscription.expired");
      return expired.length;
    },
  };
}
