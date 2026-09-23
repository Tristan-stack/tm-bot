import { touchUserActivity } from "@launchbot/db";
import type { PrismaClient } from "@launchbot/db";
import { USER_ACTIVITY_WRITE_INTERVAL_MS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { TelegramWebAppUser } from "../auth/init-data.js";

const log = createLogger("api:activity");

export type UserActivityDeps = {
  prisma: PrismaClient;
  now?: () => number;
  /** At most one write per user in this window (proposal). */
  minIntervalMs?: number;
};

/**
 * `onAuthenticated` of the API (§11.3): a request of the Mini App with a valid initData is an
 * activity of the account, like a message or a click in the bot (V1-04). One write per user
 * per minute at most, never a `User` created, and a failed write is logged, not answered: the
 * request does not depend on it.
 */
export function createUserActivity(deps: UserActivityDeps) {
  const { prisma, now = Date.now, minIntervalMs = USER_ACTIVITY_WRITE_INTERVAL_MS } = deps;
  const lastWrite = new Map<number, number>();

  return async (user: TelegramWebAppUser): Promise<void> => {
    const at = now();
    const previous = lastWrite.get(user.id);
    if (previous !== undefined && at - previous < minIntervalMs) return;
    try {
      await touchUserActivity(prisma, user.id, new Date(at));
      lastWrite.set(user.id, at);
    } catch (error) {
      log.warn({ err: error, telegramId: user.id }, "User activity not recorded");
    }
  };
}
