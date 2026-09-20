import { createLogger } from "@launchbot/shared/server";
import type { Context, MiddlewareFn } from "grammy";

const log = createLogger("bot:private");

/**
 * §4.1 and §15: in a group or a channel the bot performs no action. It answers nothing, does
 * not answer the callback query and writes nothing to the database, so it runs before every
 * other middleware. The log carries no content, only the update id and the chat type.
 */
export const privateOnly: MiddlewareFn<Context> = async (ctx, next) => {
  const { from, chat } = ctx;
  if (from === undefined || from.is_bot || chat?.type !== "private") {
    log.debug({ updateId: ctx.update.update_id, chatType: chat?.type }, "Update ignored");
    return;
  }
  await next();
};
