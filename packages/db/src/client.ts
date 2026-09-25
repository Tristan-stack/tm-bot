import { loadDotenvOnce } from "@launchbot/shared/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import type { Prisma } from "./generated/prisma/client.js";

/** A read that works on the client and inside an interactive transaction (`tx`). */
export type Db = Prisma.TransactionClient;

/**
 * One transaction at a time per user and scope (`wallet`, `ai`, `invoice`): an advisory lock
 * held until the transaction ends. `$queryRaw` fails on the void column: `$executeRaw` it is.
 */
export async function lockUserScope(tx: Db, scope: string, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope}:${userId}`}))`;
}

/**
 * The same lock without waiting: `false` when another transaction holds it, so the caller
 * refuses instead of queueing behind a send of a minute (a payment from a wallet, V1-31).
 */
export async function tryLockScope(tx: Db, scope: string, key: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtext(${`${scope}:${key}`})) AS locked`;
  return row?.locked === true;
}

/**
 * Query logging is never enabled: query parameters hold encSecretKey, iv, authTag and
 * encMnemonic.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (client === undefined) {
    // Processes validate the whole configuration with loadEnv() at startup; the client only
    // needs this variable, so scripts and tests work without a complete .env.
    loadDotenvOnce();
    const databaseUrl = process.env["DATABASE_URL"];
    if (databaseUrl === undefined || databaseUrl === "") {
      throw new Error("DATABASE_URL is not set");
    }
    client = createPrismaClient(databaseUrl);
  }
  return client;
}

/**
 * Single Prisma client of the process, created on first use: importing @launchbot/db never
 * needs a database or a configuration.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const target = getClient();
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function" ? (value.bind(target) as unknown) : value;
  },
});

/**
 * The start of a process (V1-04, V1-32): the database answers, or the process refuses to
 * start. A Prisma error can quote the connection string: only its code is kept.
 */
export async function assertDatabaseReachable(db: PrismaClient): Promise<void> {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new Error(
      `Refusing to start: cannot reach the database of DATABASE_URL (${String(code)}). Is PostgreSQL running (pnpm db:up)?`,
      { cause: error },
    );
  }
}

/** Clean shutdown (V1-04, V1-32). */
export async function disconnectPrisma(): Promise<void> {
  if (client === undefined) return;
  await client.$disconnect();
  client = undefined;
}
