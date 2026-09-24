import { SECOND_MS } from "../constants.js";
import { createLogger } from "./logger.js";

/** A long-running service: the bot, the API (V1-05), the worker (V1-32). */
export type Service = {
  name: string;
  /** Everything that can refuse the startup happens here, so that `runProcess` reports it. */
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
};

export type RunProcessOptions = {
  /** Called after every service has stopped: `disconnectPrisma`. */
  onShutdown?: () => Promise<void> | void;
  /**
   * Hard exit if a service hangs on stop. The worker (V1-32) gives its jobs 30 s to finish, so
   * it waits longer than the bot.
   */
  forceExitAfterMs?: number;
  /** Test seam. */
  exit?: (code: number) => void;
};

const FORCE_EXIT_AFTER_MS = 10 * SECOND_MS;

/**
 * Node on Windows aborts on a libuv assertion (exit code 127) when process.exit() runs while
 * the handles of a network request that just finished are still closing, which is exactly a
 * refused startup: the devnet guard has just called the RPC. `setImmediate` is not enough,
 * a short delay is.
 */
const EXIT_DELAY_MS = 100;
const exitSoon = (code: number): void => {
  setTimeout(() => process.exit(code), EXIT_DELAY_MS);
};

/**
 * Starts the services in order and stops them in reverse order on SIGINT / SIGTERM (only
 * SIGINT on Windows). §12: the bot and the API share one process. A failed start stops
 * whatever already started and exits with code 1; a second signal during the shutdown exits at
 * once. Errors are logged by name and message only.
 */
export async function runProcess(
  services: readonly Service[],
  options: RunProcessOptions = {},
): Promise<void> {
  const { onShutdown, forceExitAfterMs = FORCE_EXIT_AFTER_MS, exit = exitSoon } = options;
  const log = createLogger("process");
  const started: Service[] = [];
  let shuttingDown = false;

  const shutdown = async (reason: string, code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ reason }, "Shutting down");
    const forced = setTimeout(() => {
      log.error({ reason }, "Shutdown timed out, exiting now");
      exit(1);
    }, forceExitAfterMs);
    forced.unref();

    for (const service of started.reverse()) {
      try {
        // The bot finishes the update it is handling before it resolves.
        await service.stop();
        log.info({ service: service.name }, "Service stopped");
      } catch (err) {
        log.error({ service: service.name, err }, "Service failed to stop");
      }
    }
    try {
      await onShutdown?.();
    } catch (err) {
      log.error({ err }, "Shutdown hook failed");
    }
    clearTimeout(forced);
    exit(code);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      // Ctrl+C twice: the operator does not want to wait for the jobs.
      if (shuttingDown) {
        log.warn({ signal }, "Second signal, exiting now");
        exit(1);
        return;
      }
      void shutdown(signal, 0);
    });
  }
  process.on("unhandledRejection", (err) => {
    log.fatal({ err }, "Unhandled rejection");
    void shutdown("unhandledRejection", 1);
  });
  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });

  try {
    for (const service of services) {
      await service.start();
      started.push(service);
      log.info({ service: service.name }, "Service started");
    }
  } catch (err) {
    log.fatal({ err }, "Startup failed");
    await shutdown("startup failure", 1);
  }
}
