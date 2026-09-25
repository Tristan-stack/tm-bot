import { createLogger } from "@launchbot/shared/server";
import type { MiddlewareFn } from "grammy";
import type { Message } from "grammy/types";
import type { BotContext, PendingInput } from "../context.js";
import { isUndeletable } from "./telegram-errors.js";

const log = createLogger("bot:inputs");

/** One retry for a transport failure, then the user is told to delete it themselves (§9.4). */
const DELETE_ATTEMPTS = 2;

/** A command follows its normal course (§9.4): it is never read as the answer to an input. */
export const isCommand = (message: Message): boolean =>
  message.entities?.[0]?.type === "bot_command" && message.entities[0].offset === 0;

/**
 * Deletes the message being handled, so the chat keeps one screen (proposal). Nothing of it is
 * logged: it may be a secret. A refusal Telegram will repeat is not retried, and 429 or 5xx
 * are already retried by `autoRetry`. `true` when the message is gone from the chat.
 */
export async function deleteMessageNow(ctx: BotContext): Promise<boolean> {
  for (let attempt = 1; attempt <= DELETE_ATTEMPTS; attempt++) {
    try {
      await ctx.deleteMessage();
      return true;
    } catch (error) {
      if (attempt === DELETE_ATTEMPTS || isUndeletable(error)) {
        log.warn({ userId: ctx.from?.id, err: error }, "User message not deleted");
        return false;
      }
    }
  }
  return false;
}

export type InputKind = PendingInput["kind"];
export type PendingOf<K extends InputKind> = Extract<PendingInput, { kind: K }>;
/** `text` is the text of the message, `undefined` for a photo or a sticker. */
export type InputHandler<K extends InputKind> = (
  ctx: BotContext,
  pending: PendingOf<K>,
  text: string | undefined,
) => Promise<void>;

export type InputOptions = {
  /**
   * The message stays in the chat: an announcement (V1-38), which the admin may copy to send it
   * again after ✏️ Edit.
   */
  keepMessage?: boolean;
};

export type InputRouter = {
  /** One handler per kind of input; a second one is a programming error, caught at startup. */
  register: <K extends InputKind>(
    kind: K,
    handler: InputHandler<K>,
    options?: InputOptions,
  ) => void;
  middleware: () => MiddlewareFn<BotContext>;
};

/**
 * Routes the message that answers the input the session is waiting for (§4.5): the name of a
 * Rename (V1-11), the address and the amount of a withdrawal (V1-14). The message of the user
 * is deleted, best effort, and the handler edits the screen in place. The import input is not
 * here: `sensitiveMessageGuard` consumes it before the rate limit and the gate (§9.4), with
 * the same deletion and the same rule for commands, so a secret never reaches this router.
 */
export function createInputRouter(): InputRouter {
  const handlers = new Map<InputKind, { handler: InputHandler<InputKind> } & InputOptions>();

  return {
    register(kind, handler, options = {}) {
      if (handlers.has(kind)) throw new Error(`Input "${kind}" already has a handler`);
      // Registered by its kind: the message it receives is always of that kind.
      handlers.set(kind, { handler: handler as unknown as InputHandler<InputKind>, ...options });
    },

    middleware: () => async (ctx, next) => {
      const pending = ctx.session.pendingInput;
      const message = ctx.message;
      if (pending === undefined || message === undefined || isCommand(message)) return next();
      const route = handlers.get(pending.kind);
      if (route === undefined) return next();
      // Not waited for: the answer does not depend on it.
      const deleting = route.keepMessage === true ? undefined : deleteMessageNow(ctx);
      await route.handler(ctx, pending, message.text);
      await deleting;
    },
  };
}
