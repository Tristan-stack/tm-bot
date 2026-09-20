import { createLogger, loadEnv } from "@launchbot/shared/server";

// Validates the configuration first: exits with code 1 on any faulty variable.
const env = loadEnv();
const log = createLogger("bot");

log.info({ cluster: env.SOLANA_CLUSTER }, "Skeleton ready: grammY bot arrives in V1-04");
