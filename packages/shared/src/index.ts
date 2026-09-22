/**
 * Universal entry (browser + Node): texts, constants, screen template, formatters, schemas.
 * Nothing in this entry may import Node APIs: the Mini App bundles it.
 * Node-only code (env, logger) lives in the "./server" entry.
 */
export const PACKAGE_NAME = "@launchbot/shared";

export * from "./cache/last-known.js";
export * from "./cache/ttl-cache.js";
export * from "./callback.js";
export * from "./cluster.js";
export * from "./constants.js";
export * from "./format/index.js";
export { E } from "./i18n/emoji.js";
export type { EmojiName } from "./i18n/emoji.js";
export { enWebapp } from "./i18n/en-webapp.js";
export { en } from "./i18n/en.js";
export { DEFAULT_TERMS_VERSION, LEGAL_UPDATED_AT, resolveTermsVersion } from "./legal.js";
export * from "./schemas.js";
export * from "./solana-address.js";
export * from "./ui/index.js";
export { joinUrl, withoutTrailingSlash } from "./url.js";
export {
  getWalletLimit,
  getWithdrawFeeBudgetLamports,
  isBalanceWithdrawable,
  isWalletReady,
} from "./wallets.js";
