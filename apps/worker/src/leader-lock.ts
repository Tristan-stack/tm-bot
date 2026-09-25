import { WORKER_LOCK_RETRY_MS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import pg from "pg";

const log = createLogger("worker:leader");

/** What the lock needs of a connection: `pg.Client` in production. */
export type LockClient = {
  connect: () => Promise<unknown>;
  query: (text: string, values: unknown[]) => Promise<{ rows: { locked?: boolean }[] }>;
  end: () => Promise<void>;
  on: (event: "error", listener: (error: Error) => void) => unknown;
};

export type LeaderLock = {
  /**
   * `true` while this process holds the lock. Without it, a new attempt goes to the database
   * once per `retryMs` at most, so a stand-by worker costs one query every 30 s.
   */
  acquire: () => Promise<boolean>;
  release: () => Promise<void>;
};

/**
 * One worker runs the payment loop at a time (proposal of V1-32): a PostgreSQL session lock,
 * held on a connection of its own — not one of the pools of Prisma or pg-boss, which lend a
 * connection per query. The lock goes with the connection: a worker that dies frees it.
 */
export function createLeaderLock(options: {
  connectionString: string;
  key: string;
  retryMs?: number;
  now?: () => number;
  /** Test seam. */
  connect?: (connectionString: string) => LockClient;
}): LeaderLock {
  const {
    connectionString,
    key,
    retryMs = WORKER_LOCK_RETRY_MS,
    now = Date.now,
    connect = (url) => new pg.Client({ connectionString: url }),
  } = options;
  let client: LockClient | undefined;
  let held = false;
  let lastAttempt = -Infinity;

  async function drop(): Promise<void> {
    const closing = client;
    client = undefined;
    held = false;
    try {
      await closing?.end();
    } catch {
      // Already closed.
    }
  }

  async function open(): Promise<LockClient> {
    const opened = connect(connectionString);
    // The connection broke: the server released the lock with it.
    opened.on("error", (error: Error) => {
      if (held) log.warn({ err: error }, "worker.leader_lost");
      held = false;
      if (client === opened) client = undefined;
    });
    await opened.connect();
    return opened;
  }

  return {
    async acquire() {
      if (held) return true;
      if (now() - lastAttempt < retryMs) return false;
      lastAttempt = now();
      try {
        client ??= await open();
        const { rows } = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [
          key,
        ]);
        held = rows[0]?.locked === true;
      } catch (error) {
        log.warn({ err: error }, "worker.leader_unavailable");
        await drop();
      }
      if (held) log.info({ key }, "worker.leader");
      return held;
    },

    async release() {
      if (client !== undefined && held) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
        } catch {
          // Closing the connection releases it anyway.
        }
      }
      await drop();
    },
  };
}
