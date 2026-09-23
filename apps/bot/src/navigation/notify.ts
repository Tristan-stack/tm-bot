import { TG } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../context.js";
import { isQueryTooOld } from "./telegram-errors.js";

const log = createLogger("bot:notify");

/**
 * Telegram accepts one answer per callback query. The ids already answered are tracked here,
 * not on the context: a conversation builds its own context for the same query.
 */
const answered = new Set<string>();
const MAX_TRACKED_QUERIES = 1000;

async function answer(ctx: BotContext, other?: { text: string; show_alert: boolean }) {
  const id = ctx.callbackQuery?.id;
  if (id === undefined || answered.has(id)) return;
  answered.add(id);
  // A query lives a few seconds: keeping the most recent ids is enough to bound the set.
  if (answered.size > MAX_TRACKED_QUERIES) answered.delete(answered.values().next().value ?? id);
  try {
    await ctx.answerCallbackQuery(other);
  } catch (error) {
    if (!isQueryTooOld(error)) throw error;
  }
}

/**
 * Answers a callback query: a toast, or `{ alert: true }` for a modal alert. Later calls for
 * the same query are dropped. Outside a callback this does nothing — §4.5: an alert never
 * replaces the information written on the screen.
 */
export async function notify(
  ctx: BotContext,
  text: string,
  options: { alert?: boolean } = {},
): Promise<void> {
  const shown = text.slice(0, TG.CALLBACK_ALERT_MAX_CHARS);
  // The text itself is not logged: it can carry a user value.
  if (shown.length < text.length) log.warn({ length: text.length }, "Callback answer truncated");
  await answer(ctx, { text: shown, show_alert: options.alert === true });
}

/**
 * Answers the query with nothing, now: the client stops its spinner while a long action runs
 * (a withdrawal takes seconds, V1-14). Nothing can be said to that query afterwards.
 */
export const acknowledge = (ctx: BotContext): Promise<void> => answer(ctx);

/**
 * Wraps the whole chain: once the handlers are done, a query nobody answered is closed with
 * no text, so the client stops its spinner. A wrapper cannot be skipped by a handler that
 * does not call `next()`, which is what commands and conversations do.
 */
export const ensureAnswered: MiddlewareFn<BotContext> = async (ctx, next) => {
  await next();
  await answer(ctx);
};
