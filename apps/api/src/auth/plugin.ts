import { INIT_DATA_HEADER, INIT_DATA_MAX_AGE_SEC } from "@launchbot/shared";
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { errorBody } from "../errors.js";
import { validateInitData } from "./init-data.js";
import type { TelegramWebAppUser } from "./init-data.js";

export type TelegramAuthOptions = {
  botToken: string;
  /**
   * Called once a request is authenticated: a hook for what a request should count as, such
   * as an activity of the account (§11.3), without a route knowing about it.
   */
  onAuthenticated?: (user: TelegramWebAppUser) => Promise<void> | void;
};

declare module "fastify" {
  interface FastifyRequest {
    /**
     * The user `requireTelegramUser` authenticated. Reading it on a route that is not
     * protected throws: a handler can never get an `undefined` user, which Prisma would turn
     * into a query without its ownership filter.
     */
    readonly telegramUser: TelegramWebAppUser;
    readonly initDataAuthDate: Date;
  }
  interface FastifyInstance {
    /** preHandler of every route of the Mini App: 401 without a valid initData (§15). */
    requireTelegramUser: preHandlerAsyncHookHandler;
  }
}

type Authenticated = { user: TelegramWebAppUser; authDate: Date };

export const telegramAuth = fastifyPlugin<TelegramAuthOptions>(
  (app, options) => {
    const authenticated = new WeakMap<FastifyRequest, Authenticated>();
    const read = (request: FastifyRequest): Authenticated => {
      const found = authenticated.get(request);
      if (found === undefined) {
        throw new Error("request.telegramUser was read on a route without requireTelegramUser");
      }
      return found;
    };

    app.decorateRequest("telegramUser", {
      getter(this: FastifyRequest) {
        return read(this).user;
      },
    });
    app.decorateRequest("initDataAuthDate", {
      getter(this: FastifyRequest) {
        return read(this).authDate;
      },
    });

    app.decorate("requireTelegramUser", async (request, reply) => {
      const header = request.headers[INIT_DATA_HEADER];
      const result = validateInitData(
        typeof header === "string" ? header : undefined,
        options.botToken,
        { maxAgeSec: INIT_DATA_MAX_AGE_SEC },
      );
      if (!result.ok) {
        // The reason stays in the logs, and the header never reaches them.
        request.log.debug({ reason: result.reason }, "initData rejected");
        return reply.code(401).send(errorBody(401));
      }
      authenticated.set(request, { user: result.user, authDate: result.authDate });
      await options.onAuthenticated?.(result.user);
    });
  },
  { name: "telegram-auth" },
);
