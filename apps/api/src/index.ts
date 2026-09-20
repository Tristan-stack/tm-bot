import { createLogger, loadEnv } from "@launchbot/shared/server";

// Validates the configuration first: exits with code 1 on any faulty variable.
const env = loadEnv();
const log = createLogger("api");

log.info(
  { cluster: env.SOLANA_CLUSTER },
  "Skeleton ready: Fastify API arrives in V1-05 (it will join the bot process)",
);
