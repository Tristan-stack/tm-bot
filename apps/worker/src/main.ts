import { disconnectPrisma } from "@launchbot/db";
import { SECOND_MS, WORKER_STOP_TIMEOUT_MS } from "@launchbot/shared";
import { runProcess } from "@launchbot/shared/server";
import { createWorkerService } from "./index.js";

// The worker is a process of its own (§12). Its jobs get 30 s to finish on SIGINT / SIGTERM,
// so the forced exit waits longer than the bot's; a second signal exits at once.
await runProcess([createWorkerService()], {
  onShutdown: disconnectPrisma,
  forceExitAfterMs: WORKER_STOP_TIMEOUT_MS + 15 * SECOND_MS,
});
