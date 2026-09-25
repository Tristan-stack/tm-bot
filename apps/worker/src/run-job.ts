import { createLogger, loadEnv } from "@launchbot/shared/server";
import { createBoss, QUEUES } from "./boss.js";
import type { CronJobData, QueueName } from "./boss.js";

// A run of a retention job by hand (proposal of V1-45, recipe R9 of V1-46):
//   pnpm --filter @launchbot/worker job accounts.delete-inactive [--now 2026-12-24T03:30:00Z]
// The job goes into the queue of its cron: the running worker takes it, one run at a time, and
// a run already queued or active absorbs this one. `--now` sets the clock of that run.

const log = createLogger("worker:job");

const MANUAL: readonly QueueName[] = [QUEUES.inactiveAccounts, QUEUES.cleanup];
const isManual = (name: string | undefined): name is QueueName =>
  (MANUAL as readonly (string | undefined)[]).includes(name);

function parseArgs(args: string[]): { name: QueueName; data: CronJobData } | string {
  const [name, flag, value, ...rest] = args;
  if (!isManual(name)) return `The job must be one of: ${MANUAL.join(", ")}`;
  if (flag === undefined) return { name, data: {} };
  if (flag !== "--now" || value === undefined || rest.length > 0)
    return "Usage: job <name> [--now <ISO date>]";
  if (process.env["NODE_ENV"] === "production") return "--now is refused in production";
  if (Number.isNaN(new Date(value).getTime())) return "--now must be an ISO date";
  return { name, data: { now: new Date(value).toISOString() } };
}

const parsed = parseArgs(process.argv.slice(2));
if (typeof parsed === "string") {
  log.error(parsed);
  process.exitCode = 1;
} else {
  const env = loadEnv();
  const boss = await createBoss(env.DATABASE_URL);
  try {
    const id = await boss.send(parsed.name, parsed.data);
    if (id === null)
      log.warn({ job: parsed.name }, "A run of this job is already queued or running");
    else
      log.info({ job: parsed.name, ...parsed.data }, "Queued: the worker runs it within a minute");
  } catch (error) {
    // pg-boss refuses a queue the worker never created.
    log.error(
      { err: error, job: parsed.name },
      "Not queued: start the worker once, it creates the queues",
    );
    process.exitCode = 1;
  } finally {
    await boss.stop({ graceful: false });
  }
}
