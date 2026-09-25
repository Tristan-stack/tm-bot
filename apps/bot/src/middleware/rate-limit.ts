import { en, SECOND_MS } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../context.js";
import { notify } from "../navigation/notify.js";
import type { Block } from "../navigation/show-screen.js";

/**
 * Every update of a user (D17, `RATE_LIMITS.global`). Over the limit, nothing runs: a click
 * gets the toast, a message is dropped without an answer.
 */
export const globalRateLimit: MiddlewareFn<BotContext> = async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  if (!consumeRateLimit(userId, "global").ok) {
    if (ctx.callbackQuery !== undefined) await notify(ctx, en.common.rateLimited);
    return;
  }
  await next();
};

/** What `blockWithFlag` shows for an action over its limit: `⏳ … Try again in 12 s.` */
export function tooManyActions(retryAfterMs: number): Block {
  const text = en.common.tryAgainIn(Math.ceil(retryAfterMs / SECOND_MS));
  return { alert: text, flag: text };
}

/**
 * A Refresh button (§4.4) may skip the balance cache once per 10 s per user, whatever screen
 * it is on (home, wallet detail V1-10, Bundle V1-36). Too soon, it reads the cache and says
 * nothing about it (proposal).
 */
export const mayReadFreshBalances = (ctx: BotContext): boolean =>
  consumeRateLimit(Number(ctx.user.telegramId), "refresh").ok;
