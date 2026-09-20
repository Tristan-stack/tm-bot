import { decodeCallback, en } from "@launchbot/shared";
import type { CallbackDomain } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../context.js";
import { notify } from "../navigation/notify.js";

const log = createLogger("bot:router");

export type CallbackParams = { action: string; args: string[] };
export type CallbackHandler = (ctx: BotContext, params: CallbackParams) => Promise<void> | void;

export type CallbackRouter = {
  /** One handler per domain; a second registration is a programming error, caught at startup. */
  register: (domain: CallbackDomain, handler: CallbackHandler) => void;
  middleware: () => MiddlewareFn<BotContext>;
};

/**
 * Routes callback data by domain (§4.4). Anything this codec did not produce, an unknown
 * domain or an action a handler does not take gets the "expired button" answer: after a
 * deployment, old buttons must not look broken.
 */
export function createCallbackRouter(): CallbackRouter {
  const handlers = new Map<CallbackDomain, CallbackHandler>();

  return {
    register(domain, handler) {
      if (handlers.has(domain)) {
        throw new Error(`Callback domain "${domain}" is already registered`);
      }
      handlers.set(domain, handler);
    },

    middleware() {
      return async (ctx, next) => {
        const data = ctx.callbackQuery?.data;
        if (data === undefined) return next();

        const decoded = decodeCallback(data);
        const handler = decoded === null ? undefined : handlers.get(decoded.domain);
        if (decoded === null || handler === undefined) {
          // The data itself is not logged: an argument could hold something unexpected.
          log.warn({ domain: decoded?.domain, action: decoded?.action }, "Unroutable callback");
          return notify(ctx, en.common.staleButton);
        }
        await handler(ctx, { action: decoded.action, args: decoded.args });
      };
    },
  };
}
