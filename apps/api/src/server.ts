import cors from "@fastify/cors";
import { INIT_DATA_HEADER } from "@launchbot/shared";
import type { Env, Logger } from "@launchbot/shared/server";
import Fastify from "fastify";
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { telegramAuth } from "./auth/plugin.js";
import type { TelegramAuthOptions } from "./auth/plugin.js";
import { clientStatus, errorBody } from "./errors.js";

export type ApiDeps = {
  env: Pick<Env, "BOT_TOKEN" | "WEBAPP_URL">;
  logger: Logger;
  /**
   * The routes of the Mini App, if it needs one again (none since D21: the simulation runs in
   * the chat). They are mounted under `/api`, where every route requires a Telegram user: a
   * route cannot be public because its author forgot a preHandler.
   */
  routes?: (api: FastifyInstance) => Promise<void> | void;
  onAuthenticated?: TelegramAuthOptions["onAuthenticated"];
};

/** Browsers cache a preflight for 5 s by default, and the custom header forces one per call. */
const PREFLIGHT_MAX_AGE_SEC = 7200;

/** One exit for every failure: a fixed body per status, and the error in the logs only. */
function fail(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const status = clientStatus(error);
  // A refused request is routine. What the operator must see is a failure of ours.
  request.log[status === 500 ? "error" : "info"]({ err: error }, "Request failed");
  void reply.code(status).send(errorBody(status));
}

/**
 * The API of the Mini App, without `listen`: tests drive it with `app.inject`. It depends on
 * neither grammY nor any state of the bot, so it runs alone or inside the bot process (§12).
 */
export async function buildApiServer(deps: ApiDeps): Promise<FastifyInstance> {
  const { env, logger, routes, onAuthenticated } = deps;
  // The logger of @launchbot/shared redacts the initData header and scrubs the bot token.
  // Widened to Fastify's own logger type, so the instance is a plain FastifyInstance.
  const loggerInstance: FastifyBaseLogger = logger;
  // `frameworkErrors`: a malformed URL never reaches the handlers below.
  const app = Fastify({ loggerInstance, frameworkErrors: fail });
  app.setErrorHandler(fail);
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(errorBody(404)));

  // Only the Mini App may call the API from a browser: another origin gets no
  // Access-Control-Allow-Origin. The custom header triggers a preflight.
  await app.register(cors, {
    origin: [new URL(env.WEBAPP_URL).origin],
    methods: ["GET"],
    allowedHeaders: [INIT_DATA_HEADER, "content-type"],
    maxAge: PREFLIGHT_MAX_AGE_SEC,
  });
  await app.register(telegramAuth, { botToken: env.BOT_TOKEN, onAuthenticated });

  // Public, and silent about the environment: no cluster, no version, no variable.
  app.get("/health", () => ({ status: "ok" }));

  await app.register(
    async (api) => {
      api.addHook("preHandler", api.requireTelegramUser);
      // An unknown path answers 401 before 404 (§15, V1-46): without a valid initData the API
      // says nothing, not even which routes exist. None does since D21.
      api.setNotFoundHandler({ preHandler: api.requireTelegramUser }, (_request, reply) =>
        reply.code(404).send(errorBody(404)),
      );
      await routes?.(api);
    },
    { prefix: "/api" },
  );

  return app;
}
