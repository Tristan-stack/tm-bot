import { INACTIVITY_DELETE_MS } from "./constants.js";

/** The last activity an account may have to be deleted by a pass started at `now` (V1-45). */
export const inactivityCutoff = (now: Date): Date => new Date(now.getTime() - INACTIVITY_DELETE_MS);

/**
 * Decision of 16/09/2026: an account without activity for `INACTIVITY_DELETE_MS` (24 h since
 * 25/09/2026) is deleted, whatever it holds; the only exception is an id of
 * `ADMIN_TELEGRAM_IDS` (an empty list exempts nobody).
 */
export function isInactiveCandidate(
  user: { telegramId: bigint; lastActiveAt: Date },
  options: { now: Date; adminIds: readonly number[] },
): boolean {
  if (options.adminIds.some((id) => BigInt(id) === user.telegramId)) return false;
  return user.lastActiveAt < inactivityCutoff(options.now);
}
