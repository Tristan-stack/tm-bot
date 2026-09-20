import { decodeCallback, en } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { GrammyError } from "grammy";
import type { BotError } from "grammy";
import type { BotContext } from "./context.js";
import { notify } from "./navigation/notify.js";

const log = createLogger("bot:error");

/**
 * §9.6 and §14: never log `ctx.update`, a message text or `GrammyError.payload` — a user can
 * paste a private key at any moment. Only the shape of the update, and the error as the
 * logger serializes it: name and scrubbed message.
 */
export async function handleBotError({ error, ctx }: BotError<BotContext>): Promise<void> {
  const data = ctx.callbackQuery?.data;
  log.error(
    {
      updateId: ctx.update.update_id,
      updateType: Object.keys(ctx.update).find((key) => key !== "update_id"),
      userId: ctx.from?.id,
      callbackDomain: data === undefined ? undefined : decodeCallback(data)?.domain,
      // Deliberately no `payload`: it holds the text we sent and the user input.
      ...(error instanceof GrammyError
        ? { method: error.method, errorCode: error.error_code, description: error.description }
        : {}),
      err: error,
    },
    "Update failed",
  );

  // Best effort feedback, never a stack or a technical detail.
  try {
    if (ctx.callbackQuery !== undefined) {
      await notify(ctx, en.common.genericError, { alert: true });
    } else {
      await ctx.reply(en.common.genericError);
    }
  } catch (err) {
    log.error({ err }, "Could not tell the user about the error");
  }
}
