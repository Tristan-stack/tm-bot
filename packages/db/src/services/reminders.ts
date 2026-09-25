import { DURATIONS, reminderLeadMs, REMINDER_BATCH_SIZE } from "@launchbot/shared";
import type { SubscriptionPeriod } from "@launchbot/shared";
import type { PrismaClient } from "../generated/prisma/client.js";

// The reminder before the end of a plan (§8.4, V1-34). One per end: the end it went out for is
// kept on the row, so an extension, which moves the end, re-arms it with nothing to reset.

/** A subscription whose reminder is due, and whom to send it to. */
export type DueReminder = SubscriptionPeriod & { id: string; telegramId: bigint };

export type ReminderService = {
  /**
   * Active subscriptions within their notice (24 h, 6 h for a 2-day pass) and not reminded for
   * their end yet, the closest end first. A purged account has no subscription left (§11.3).
   */
  listDue: (now: Date) => Promise<DueReminder[]>;
  /**
   * Taken before the send, by a conditional update: `false` when another run took it, or when
   * the end moved since the read. A reminder is rarely lost rather than ever sent twice.
   */
  claim: (reminder: DueReminder, now: Date) => Promise<boolean>;
  /** A send that may work later (network, 429, 5xx): the reminder is armed again. */
  release: (reminder: DueReminder) => Promise<void>;
};

export function createReminderService(deps: { prisma: PrismaClient }): ReminderService {
  const { prisma } = deps;
  const { expiresAt: end } = prisma.subscription.fields;

  return {
    async listDue(now) {
      const rows = await prisma.subscription.findMany({
        where: {
          status: "ACTIVE",
          // The notice depends on the duration of the last pass (V1-27).
          OR: DURATIONS.map((duration) => ({
            duration,
            expiresAt: { gt: now, lte: new Date(now.getTime() + reminderLeadMs(duration)) },
          })),
          // « not reminded for this end »: null, or another end (a comparison of two columns).
          AND: {
            OR: [
              { reminderForExpiresAt: null },
              { reminderForExpiresAt: { lt: end } },
              { reminderForExpiresAt: { gt: end } },
            ],
          },
        },
        orderBy: { expiresAt: "asc" },
        take: REMINDER_BATCH_SIZE,
        select: {
          id: true,
          plan: true,
          duration: true,
          startsAt: true,
          expiresAt: true,
          user: { select: { telegramId: true } },
        },
      });
      return rows.map(({ user, ...row }) => ({ ...row, telegramId: user.telegramId }));
    },

    async claim(reminder, now) {
      const { count } = await prisma.subscription.updateMany({
        where: {
          id: reminder.id,
          status: "ACTIVE",
          expiresAt: reminder.expiresAt,
          OR: [
            { reminderForExpiresAt: null },
            { reminderForExpiresAt: { not: reminder.expiresAt } },
          ],
        },
        data: { reminderSentAt: now, reminderForExpiresAt: reminder.expiresAt },
      });
      return count === 1;
    },

    async release(reminder) {
      // Only the claim of this end: a later one, after an extension, is left alone. The end it
      // held before was another one or none: either way, not reminded for this end.
      await prisma.subscription.updateMany({
        where: { id: reminder.id, reminderForExpiresAt: reminder.expiresAt },
        data: { reminderSentAt: null, reminderForExpiresAt: null },
      });
    },
  };
}
