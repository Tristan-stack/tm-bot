/** Wallets, balances, withdrawals, encryption; pump.fun and PumpSwap in V2. */
export const PACKAGE_NAME = "@launchbot/solana";

export { isOnCurve, isValidSolanaAddress, solanaAddressSchema } from "./address.js";
export { assertDevnet, DevnetGuardError, rpcHost } from "./guard.js";
export type { DevnetGuardParams } from "./guard.js";
export { looksLikePrivateKey, looksLikeSeedPhrase } from "./keys/detect.js";
export {
  InvalidMasterKeyError,
  InvalidMnemonicError,
  KeyDecryptionError,
  KeyIntegrityError,
} from "./keys/errors.js";
export { generateKeypair } from "./keys/keypair.js";
export type { GeneratedKeypair, ImportFailureReason, ImportResult } from "./keys/keypair.js";
export {
  generateMnemonicWallet,
  normalizeMnemonic,
  parseSeedPhrase,
  SOLANA_DERIVATION_PATH,
} from "./keys/mnemonic.js";
export type { MnemonicWallet } from "./keys/mnemonic.js";
export { parsePrivateKey } from "./keys/private-key.js";
export { revealWalletSecrets } from "./keys/reveal.js";
export type { WalletSecrets, WalletSecretsRow, WalletSource } from "./keys/reveal.js";
export { SecretBytes } from "./keys/secret-bytes.js";
export { createKeyVault } from "./keys/vault.js";
export type {
  EncryptedMnemonic,
  EncryptedSecret,
  KeyVault,
  SolanaSigner,
  StoredMnemonic,
  StoredSecret,
} from "./keys/vault.js";
export { getBalancesFresh } from "./lamports.js";
export type { BalancesReader } from "./lamports.js";
export { createCoinGeckoProvider } from "./price/coingecko.js";
export { createSolUsdPrice } from "./price/sol-usd.js";
export type { SolPriceProvider, SolUsdPrice, SolUsdQuote } from "./price/sol-usd.js";
export { getSolanaRpc } from "./rpc.js";
