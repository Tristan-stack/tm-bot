import { touchUserActivity } from "@launchbot/db";
import type { PrismaClient } from "@launchbot/db";
import {
  createTtlCache,
  PER_USER_CACHE_MAX_ENTRIES,
  USER_ACTIVITY_WRITE_INTERVAL_MS,
} from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { TelegramWebAppUser } from "../auth/init-data.js";

const log = createLogger("api:activity");

export type UserActivityDeps = { prisma: PrismaClient; now?: () => number };

/**
 * `onAuthenticated` of the API (§11.3): a request of the Mini App with a valid initData is an
 * activity of the account, like a message or a click in the bot (V1-04). One write per user
 * per minute at most (the requests of one page load share it), never a `User` created, and a
 * failed write is logged, not answered: the request does not depend on it.
 */
export function createUserActivity({ prisma, now }: UserActivityDeps) {
  const written = createTtlCache<number, boolean>({
    ttlMs: USER_ACTIVITY_WRITE_INTERVAL_MS,
    maxEntries: PER_USER_CACHE_MAX_ENTRIES,
    now,
  });

  return async (user: TelegramWebAppUser): Promise<void> => {
    try {
      await written.get(user.id, () =>
        touchUserActivity(prisma, user.id, new Date(now?.() ?? Date.now())),
      );
    } catch (error) {
      log.warn({ err: error, telegramId: user.id }, "User activity not recorded");
    }
  };
}
