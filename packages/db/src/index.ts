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
export { createBalancesService } from "./services/balances.js";
export type {
  BalancesDeps,
  BalancesService,
  UserBalances,
  WalletBalance,
} from "./services/balances.js";
export {
  createActiveSubscriberCounter,
  getActiveSubscription,
  getSubscriptionSummary,
  getWalletQuota,
} from "./services/subscriptions.js";
export type {
  SubscriptionInfo,
  SubscriptionSummary,
  WalletQuota,
} from "./services/subscriptions.js";
export { acceptTerms, setChannelCheckedAt, touchUser } from "./services/user.js";
export type { TelegramIdentity } from "./services/user.js";
export * from "./generated/prisma/client.js";
