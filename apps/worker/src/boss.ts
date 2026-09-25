import { createLogger } from "@launchbot/shared/server";
import { PgBoss } from "pg-boss";
import type { JobWithMetadata, Queue } from "pg-boss";

const log = createLogger("worker:boss");

/** Every queue of the worker (§12). pg-boss 10+ refuses a send or a work on an unknown queue. */
export const QUEUES = {
  /** « Payment received » after an activation made by the worker (V1-32). */
  notifyPaid: "payments.notify-paid",
  /** One deposit moved to the treasury (V1-33), keyed by invoice. */
  sweep: "deposits.sweep",
  sweepPaid: "deposits.sweep-paid",
  watch: "deposits.watch",
  purgeKeys: "deposits.purge-keys",
  /** The end-of-plan reminder and the expiry (V1-34). */
  remind: "subscriptions.remind",
  expire: "subscriptions.expire",
} as const;

type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** The retry options of a queue, inherited by each of its jobs. */
type QueueOptions = Pick<Queue, "retryLimit" | "retryDelay" | "retryBackoff">;

/**
 * How often a cron queue asks for its job (proposal): its job comes once a minute at most, and
 * the default of pg-boss (2 s) would poll 30 times for it.
 */
const CRON_POLLING_SECONDS = 30;

/**
 * pg-boss started on the database of Prisma, in its own `pgboss` schema: Prisma manages
 * `public` only, so its migrations never see the job tables (no drift).
 */
export async function createBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString, application_name: "launchbot-worker" });
  // An error of the maintenance or of a poll is reported here, never thrown: logged scrubbed.
  boss.on("error", (error) => log.error({ err: error }, "boss.error"));
  await boss.start();
  return boss;
}

/**
 * A queue and its worker. `exclusive`: one job queued or active per singleton key, so a job
 * sent twice for the same invoice runs once, and a cron without a key never overlaps itself.
 * A handler that throws fails its job, retried by the options of the queue.
 */
export async function workQueue<T extends object>(
  boss: PgBoss,
  name: QueueName,
  options: QueueOptions,
  handler: (job: JobWithMetadata<T>) => Promise<unknown>,
  pollingIntervalSeconds?: number,
): Promise<void> {
  await boss.createQueue(name, { policy: "exclusive", ...options });
  // An existing queue keeps its options otherwise: the code is the reference.
  await boss.updateQueue(name, options);
  // Explicit type arguments stop the inference: the options type is spelled out too.
  await boss.work<T, void, { includeMetadata: true; pollingIntervalSeconds?: number }>(
    name,
    {
      includeMetadata: true,
      ...(pollingIntervalSeconds === undefined ? {} : { pollingIntervalSeconds }),
    },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await handler(job);
        } catch (error) {
          log.warn({ err: error, queue: name, jobId: job.id, retry: job.retryCount }, "job.failed");
          throw error;
        }
      }
    },
  );
}

/**
 * A job on a cron of pg-boss (resolution: one minute, UTC). No retry: the next run is the
 * retry, and the exclusive policy drops a run while the previous one is still going.
 */
export async function scheduleCron(
  boss: PgBoss,
  name: QueueName,
  cron: string,
  handler: () => Promise<unknown>,
): Promise<void> {
  await workQueue(boss, name, { retryLimit: 0 }, () => handler(), CRON_POLLING_SECONDS);
  await boss.schedule(name, cron, null, { tz: "UTC" });
}
