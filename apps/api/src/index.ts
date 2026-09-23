import { createSimulationStore, prisma } from "@launchbot/db";
import { createLogger, createTelegramFileClient, loadEnv } from "@launchbot/shared/server";
import type { Service } from "@launchbot/shared/server";
import type { FastifyInstance } from "fastify";
import { registerSimulationRoutes } from "./routes/simulations.js";
import { buildApiServer } from "./server.js";
import { createTokenImageService } from "./services/token-image.js";
import { createUserActivity } from "./services/user-activity.js";

export { buildApiServer } from "./server.js";
export type { ApiDeps } from "./server.js";

/**
 * The API as a service of `runProcess`: alone (`main.ts`) or next to the bot, in the same
 * process (§12). Importing this module has no side effect. The API never talks to Solana, and
 * ESLint keeps it that way, so it needs no devnet guard of its own.
 */
export function createApiService(): Service {
  let app: FastifyInstance | undefined;

  return {
    name: "api",
    async start() {
      const env = loadEnv();
      const images = createTokenImageService({
        client: createTelegramFileClient({ botToken: env.BOT_TOKEN }),
      });
      app = await buildApiServer({
        env,
        logger: createLogger("api"),
        routes: (api) =>
          registerSimulationRoutes(api, { simulations: createSimulationStore({ prisma }), images }),
        onAuthenticated: createUserActivity({ prisma }),
      });
      await app.listen({ port: env.API_PORT, host: env.API_HOST });
    },
    // Finishes the requests in flight before it resolves.
    stop: () => app?.close(),
  };
}
