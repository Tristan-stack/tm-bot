import { loadDotenvOnce } from "@launchbot/shared/server";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

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

/** Clean shutdown (V1-04, V1-32). */
export async function disconnectPrisma(): Promise<void> {
  if (client === undefined) return;
  await client.$disconnect();
  client = undefined;
}
