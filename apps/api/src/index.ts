import { createLogger, loadEnv } from "@launchbot/shared/server";
import type { Service } from "@launchbot/shared/server";
import type { FastifyInstance } from "fastify";
import { buildApiServer } from "./server.js";

export { buildApiServer } from "./server.js";
export type { ApiDeps } from "./server.js";

/**
 * The API as a service of `runProcess`: alone (`main.ts`) or next to the bot, in the same
 * process (§12). Importing this module has no side effect. The API never talks to Solana, and
 * ESLint keeps it that way, so it needs no devnet guard of its own.
 *
 * Since D21 (24/09/2026) no page reads the API: the simulation runs in the chat. What stays
 * is the skeleton of V1-05 (`/health`, the initData plugin and the protected `/api` scope),
 * ready for a route that a Mini App page would need one day.
 */
export function createApiService(): Service {
  let app: FastifyInstance | undefined;

  return {
    name: "api",
    async start() {
      const env = loadEnv();
      app = await buildApiServer({ env, logger: createLogger("api") });
      await app.listen({ port: env.API_PORT, host: env.API_HOST });
    },
    // Finishes the requests in flight before it resolves.
    stop: () => app?.close(),
  };
}
