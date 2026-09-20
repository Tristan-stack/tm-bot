import { createLogger, loadEnv } from "@launchbot/shared/server";

// Validates the configuration first: exits with code 1 on any faulty variable.
const env = loadEnv();
const log = createLogger("worker");

log.info({ cluster: env.SOLANA_CLUSTER }, "Skeleton ready: pg-boss jobs arrive in V1-32");
