import { en } from "@launchbot/shared";
import { looksLikePrivateKey, looksLikeSeedPhrase } from "@launchbot/solana";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../context.js";
import { deleteMessageNow, isCommand } from "../navigation/inputs.js";

/** What the consumer of an import receives: its message is already out of the chat. */
export type SecretMessage = {
  /** `text` or `caption`; `undefined` for a sticker or a photo without a caption. */
  text: string | undefined;
  /** False when Telegram refused the deletion: the screen has to say so. */
  deleted: boolean;
};

/**
 * The input the wallets section is waiting for (V1-12). The middleware runs before the rate limit
 * and the gate, so it knows nothing of that section: `waiting` tells it whether this message is
 * answering an input, and hands back what it found so `consume` needs no second look.
 */
export type SecretConsumer<Waiting> = {
  waiting: (ctx: BotContext) => Waiting | undefined;
  consume: (ctx: BotContext, waiting: Waiting, message: SecretMessage) => Promise<void>;
};

/**
 * The one place a private key or a seed phrase may reach (§9.4, §14). It runs on private
 * messages and edited messages, before the rate limit and `accessGate`: a secret must leave the
 * chat even from a user who is over their limit or has not joined the channel yet, and no
 * request log, no conversation and no other handler may see the text.
 *
 * - An import is waiting: the text is read, the message deleted **before** any validation, then
 *   the consumer answers. Nothing calls `next()`, so the secret goes no further.
 * - Otherwise a text that looks like a key or a phrase (V1-09 heuristics) is deleted and the
 *   chain stops, so it cannot land in an input opened for something else (a Rename, V1-11).
 *   A public address and ordinary text pass through untouched.
 */
export function sensitiveMessageGuard<Waiting>(
  consumer: SecretConsumer<Waiting>,
): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const message = ctx.message ?? ctx.editedMessage;
    if (message === undefined) return next();
    const text = message.text ?? message.caption;

    // Only a new message answers an input: editing an old one is not sending us a secret, so it
    // falls to the guard below, which deletes it if it looks like one.
    const waiting =
      ctx.message !== undefined && !isCommand(ctx.message) ? consumer.waiting(ctx) : undefined;
    if (waiting !== undefined) {
      // Deleted first, whatever the text turns out to be: the consumer may fail, the chat is
      // clean either way.
      const deleted = await deleteMessageNow(ctx);
      await consumer.consume(ctx, waiting, { text, deleted });
      return;
    }

    if (text === undefined || !(looksLikePrivateKey(text) || looksLikeSeedPhrase(text))) {
      return next();
    }
    const deleted = await deleteMessageNow(ctx);
    const { sensitive } = en.wallets;
    // A separate message (proposal): the screen the user is on keeps its place and its buttons.
    await ctx.reply(
      [deleted ? sensitive.deleted : sensitive.notDeleted, sensitive.advice].join(" "),
    );
  };
}
