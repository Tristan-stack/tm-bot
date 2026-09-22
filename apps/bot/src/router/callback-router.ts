import { decodeCallback, en } from "@launchbot/shared";
import type { CallbackDomain } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../context.js";
import { notify } from "../navigation/notify.js";

const log = createLogger("bot:router");

/** `args` is what follows the action in the callback data: ids and enum codes (§4.4). */
export type CallbackHandler = (ctx: BotContext, args: string[]) => Promise<unknown> | void;

export type CallbackRouter = {
  /**
   * The handlers of a domain, by action. A second registration is a programming error, caught
   * at startup — unless the first one was provisional.
   */
  register: (domain: CallbackDomain, actions: Record<string, CallbackHandler>) => void;
  /**
   * A placeholder for every action of a domain whose ticket is not delivered yet (V1-08). The
   * `register` of that ticket replaces it, with nothing to remove anywhere.
   */
  registerProvisional: (domain: CallbackDomain, handler: CallbackHandler) => void;
  middleware: () => MiddlewareFn<BotContext>;
};

type Route = { provisional: CallbackHandler } | { actions: Record<string, CallbackHandler> };

/**
 * Routes callback data by domain, then by action (§4.4). Anything this codec did not produce,
 * an unknown domain or an unknown action gets the "expired button" answer: after a
 * deployment, old buttons must not look broken.
 */
export function createCallbackRouter(): CallbackRouter {
  const routes = new Map<CallbackDomain, Route>();

  return {
    register(domain, actions) {
      const existing = routes.get(domain);
      if (existing !== undefined && "actions" in existing) {
        throw new Error(`Callback domain "${domain}" is already registered`);
      }
      routes.set(domain, { actions });
    },

    registerProvisional(domain, handler) {
      if (!routes.has(domain)) routes.set(domain, { provisional: handler });
    },

    middleware() {
      return async (ctx, next) => {
        const data = ctx.callbackQuery?.data;
        if (data === undefined) return next();

        const decoded = decodeCallback(data);
        const route = decoded === null ? undefined : routes.get(decoded.domain);
        const handler =
          route === undefined || decoded === null
            ? undefined
            : "actions" in route
              ? route.actions[decoded.action]
              : route.provisional;
        if (decoded === null || handler === undefined) {
          // The data itself is not logged: an argument could hold something unexpected.
          log.warn({ domain: decoded?.domain, action: decoded?.action }, "Unroutable callback");
          return notify(ctx, en.common.staleButton);
        }
        await handler(ctx, decoded.args);
      };
    },
  };
}
