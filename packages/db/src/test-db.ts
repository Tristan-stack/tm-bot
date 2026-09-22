import { execSync } from "node:child_process";
import { join } from "node:path";
import { loadDotenvOnce } from "@launchbot/shared/server";
import { createPrismaClient } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";

/** Matches docker-compose.yml: used when no .env exists yet. */
const DEFAULT_DATABASE_URL = "postgresql://launchbot:launchbot@localhost:5440/launchbot";

const PACKAGE_DIR = join(import.meta.dirname, "..");

/**
 * TEST_DATABASE_URL, or DATABASE_URL with `_test` appended to the database name. `suffix` gives
 * a suite its own database: Vitest runs the projects in parallel, and two suites resetting the
 * same database would drop it under each other.
 */
export function testDatabaseUrl(suffix?: string): string {
  loadDotenvOnce();
  const explicit = process.env["TEST_DATABASE_URL"];
  const hasExplicit = explicit !== undefined && explicit !== "";
  const url = new URL(
    hasExplicit ? explicit : (process.env["DATABASE_URL"] ?? DEFAULT_DATABASE_URL),
  );
  if (!hasExplicit) url.pathname += "_test";
  if (suffix !== undefined) url.pathname = url.pathname.replace(/_test$/, `_${suffix}_test`);
  return url.toString();
}

/**
 * Integration tests only (RUN_DB_TESTS=1): drops the test database, recreates it empty and
 * applies every migration with `prisma migrate deploy`. Refuses any database whose name does
 * not end with `_test`, so a misconfigured URL can never wipe real data.
 */
export async function resetTestDatabase(suffix?: string): Promise<string> {
  const url = new URL(testDatabaseUrl(suffix));
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+_test$/.test(database)) {
    throw new Error("Refusing to reset a database whose name does not end with _test");
  }

  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";
  const admin = createPrismaClient(maintenanceUrl.toString());
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync("pnpm exec prisma migrate deploy", {
    cwd: PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: "pipe",
  });
  return url.toString();
}

let nextTelegramId = 7_000_000n;

/** A fresh user per test: the Telegram ids of a process never collide. */
export const createTestUser = (prisma: PrismaClient) =>
  prisma.user.create({ data: { telegramId: nextTelegramId++ } });

/** A `Wallet` row with placeholder key material: what a test needs when it is not about keys. */
export const testWalletData = (userId: string, name: string, publicKey: string) => ({
  userId,
  name,
  publicKey,
  source: "CREATED" as const,
  encSecretKey: new Uint8Array([1, 2, 3]),
  iv: new Uint8Array([4, 5]),
  authTag: new Uint8Array([6]),
});
