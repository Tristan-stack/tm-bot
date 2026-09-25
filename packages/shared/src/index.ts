/**
 * Universal entry (browser + Node): texts, constants, screen template, formatters, schemas.
 * Nothing in this entry may import Node APIs: the Mini App bundles it.
 * Node-only code (env, logger) lives in the "./server" entry.
 */
export const PACKAGE_NAME = "@launchbot/shared";

export { buildDepositAlert } from "./admin/deposit-alerts.js";
export type { AlertInvoice, DepositAlert } from "./admin/deposit-alerts.js";
export * from "./ai/types.js";
export { chunk } from "./array.js";
export * from "./cache/last-known.js";
export * from "./cache/ttl-cache.js";
export * from "./callback.js";
export * from "./cluster.js";
export * from "./constants.js";
export * from "./format/index.js";
export { E } from "./i18n/emoji.js";
export type { EmojiName } from "./i18n/emoji.js";
export { enWebapp } from "./i18n/en-webapp.js";
export { en, warn } from "./i18n/en.js";
export * from "./launch/funds.js";
export { DEFAULT_TERMS_VERSION, LEGAL_UPDATED_AT, resolveTermsVersion } from "./legal.js";
export * from "./schemas.js";
export * from "./solana-address.js";
export * from "./subscription/index.js";
export * from "./token/index.js";
export * from "./ui/index.js";
export { joinUrl, withoutTrailingSlash } from "./url.js";
export {
  computeMaxAmount,
  getWalletLimit,
  getWithdrawFeeBudgetLamports,
  isBalanceWithdrawable,
  isWalletReady,
  priorityFeeLamports,
  transferFeeLamports,
  transferShortfall,
} from "./wallets.js";
