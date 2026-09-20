/**
 * Prisma schema, client and shared business services. Node only: never imported by the
 * Mini App. Business services arrive with their own tickets in ./services/.
 *
 * BigInt and Decimal do not survive JSON.stringify: convert them explicitly (API, logs).
 * Never call prisma.user.delete outside the purge service (V1-44): the cascade erases the
 * encrypted wallet keys and makes the funds unrecoverable.
 */
export const PACKAGE_NAME = "@launchbot/db";

export { createPrismaClient, disconnectPrisma, prisma } from "./client.js";
export { isUniqueViolation } from "./errors.js";
export * from "./generated/prisma/client.js";
