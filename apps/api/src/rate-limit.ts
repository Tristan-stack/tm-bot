import { SECOND_MS } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import type { RateLimitedAction } from "@launchbot/shared/server";
import type { preHandlerAsyncHookHandler } from "fastify";
import { errorBody } from "./errors.js";

/**
 * D17 on the API: the quota of the Telegram user, shared with the bot (`consumeRateLimit`),
 * checked once the initData is valid, so a route lists it after `requireTelegramUser` of the
 * `/api` scope. Over it: 429 with `Retry-After`.
 */
export const rateLimited =
  (action: RateLimitedAction): preHandlerAsyncHookHandler =>
  async (request, reply) => {
    const verdict = consumeRateLimit(request.telegramUser.id, action);
    if (verdict.ok) return;
    return reply
      .header("retry-after", String(Math.ceil(verdict.retryAfterMs / SECOND_MS)))
      .code(429)
      .send(errorBody(429));
  };
