import { en } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../context.js";
import { notify } from "../navigation/notify.js";

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
