/**
 * Prisma schema, client and shared business services. Node only: never imported by the
 * Mini App. Business services arrive with their own tickets in ./services/.
 *
 * BigInt and Decimal do not survive JSON.stringify: convert them explicitly (API, logs).
 * Never call prisma.user.delete outside the purge service (V1-44): the cascade erases the
 * encrypted wallet keys and makes the funds unrecoverable.
 */
export const PACKAGE_NAME = "@launchbot/db";

export {
  assertDatabaseReachable,
  createPrismaClient,
  disconnectPrisma,
  lockUserScope,
  prisma,
} from "./client.js";
export { isUniqueViolation } from "./errors.js";
export { createBalancesService, readFreshWallet } from "./services/balances.js";
export type {
  BalancesDeps,
  BalancesService,
  FreshWalletRead,
  UserBalances,
  WalletBalance,
} from "./services/balances.js";
export {
  createActiveSubscriberCounter,
  createSubscriptionService,
  getActiveSubscription,
  getPlanStatus,
  getWalletQuota,
  hasActivePremium,
  hasActiveSubscription,
} from "./services/subscriptions.js";
export { createAiQuotaStore, nextUtcMidnight, startOfUtcDay } from "./services/ai-generations.js";
export type { AiQuotaDeps, AiQuotaReservation, AiQuotaStore } from "./services/ai-generations.js";
export { createPaymentService } from "./services/payments.js";
export type {
  AwaitingCheck,
  CancelResult,
  CreateInvoiceResult,
  InvoiceCheck,
  InvoiceRow,
  InvoiceView,
  PaidNotice,
  PaymentsDeps,
  PaymentService,
} from "./services/payments.js";
export { createReminderService } from "./services/reminders.js";
export type { DueReminder, ReminderService } from "./services/reminders.js";
export { createSimulationStore } from "./services/simulations.js";
export type {
  NewSimulation,
  SimulationKey,
  SimulationStore,
  SimulationWithDraft,
} from "./services/simulations.js";
export { createTokenDraftService } from "./services/token-drafts.js";
export type {
  TokenDraftFields,
  TokenDraftPatch,
  TokenDraftsDeps,
  TokenDraftService,
} from "./services/token-drafts.js";
export type {
  ActivationResult,
  ExpiredSubscription,
  GrantResult,
  SubscriptionInfo,
  SubscriptionService,
  WalletQuota,
} from "./services/subscriptions.js";
export { acceptTerms, setChannelCheckedAt, touchUser } from "./services/user.js";
export type { TelegramIdentity } from "./services/user.js";
export { createWalletService } from "./services/wallets.js";
export type {
  CreateWalletResult,
  DeleteCheck,
  DeleteResult,
  GeneratedWallet,
  RenameIssue,
  RenameResult,
  SecretParsers,
  WalletDetailData,
  WalletImportResult,
  WalletListData,
  WalletsDeps,
  WalletService,
  WalletSummary,
  WalletVault,
} from "./services/wallets.js";
export { createTreasuryService } from "./services/treasury.js";
export type { SweepResult, TreasuryService } from "./services/treasury.js";
export { createWalletPaymentService } from "./services/wallet-payments.js";
export type {
  PayChoice,
  PayChoices,
  PayChoicesResult,
  PayInFlight,
  PayOptions,
  PayOutcome,
  PayQuote,
  PayQuoteResult,
  PayRefusal,
  PayRequest,
  WalletPaymentsDeps,
  WalletPaymentService,
} from "./services/wallet-payments.js";
export { createWithdrawalService, resolveWithdrawAmount } from "./services/withdrawals.js";
export type {
  TransferApi,
  WithdrawAmount,
  WithdrawalsDeps,
  WithdrawalService,
  WithdrawCheck,
  WithdrawOkCheck,
  WithdrawOutcome,
  WithdrawQuote,
  WithdrawRequest,
} from "./services/withdrawals.js";
export * from "./generated/prisma/client.js";
