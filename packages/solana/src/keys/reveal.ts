import bs58 from "bs58";
import { KeyIntegrityError } from "./errors.js";
import { walletFromMnemonic } from "./mnemonic.js";
import { redacted } from "./secret-bytes.js";
import { decryptMnemonic, decryptSecretKey, masterKeyOf } from "./vault.js";
import type { KeyVault, StoredMnemonic, StoredSecret } from "./vault.js";

/** A `Wallet` row of Prisma fits as it is. */
export type WalletSecretsRow = StoredSecret & {
  publicKey: string;
  source: WalletSource;
} & { [K in keyof StoredMnemonic]: Uint8Array | null };

/** The `WalletSource` enum of the schema, without importing @launchbot/db. */
export type WalletSource = "CREATED" | "IMPORTED_KEY" | "IMPORTED_SEED";

export type WalletSecrets = {
  /** The 64 bytes in base58: the "Import private key" format of Phantom and Solflare. */
  privateKeyBase58: string;
  /** The normalized phrase; null for a wallet imported by private key. */
  mnemonic: string | null;
};

/**
 * The only function that returns a stored secret in clear (§11.4, decision of 16/09/2026),
 * reserved to `/getall` (V1-43): ESLint refuses its import anywhere else. It is a function
 * and not a method so the vault carries no such capability around. The caller keeps the
 * strings for the time of one message, never in a session or a log.
 */
export function revealWalletSecrets(wallet: WalletSecretsRow, vault: KeyVault): WalletSecrets {
  const masterKey = masterKeyOf(vault);
  const secretKey = decryptSecretKey(masterKey, wallet, wallet.publicKey);
  const privateKeyBase58 = bs58.encode(secretKey);
  secretKey.fill(0);
  return redacted({ privateKeyBase58, mnemonic: revealMnemonic(masterKey, wallet) });
}

function revealMnemonic(masterKey: Uint8Array, wallet: WalletSecretsRow): string | null {
  const { encMnemonic, mnemonicIv, mnemonicAuthTag } = wallet;
  if (encMnemonic === null && mnemonicIv === null && mnemonicAuthTag === null) return null;
  // Proposal: a half-filled row, or a phrase on a key import, is a corrupted row.
  if (
    encMnemonic === null ||
    mnemonicIv === null ||
    mnemonicAuthTag === null ||
    wallet.source === "IMPORTED_KEY"
  ) {
    throw new KeyIntegrityError();
  }
  const mnemonic = decryptMnemonic(
    masterKey,
    { encMnemonic, mnemonicIv, mnemonicAuthTag },
    wallet.publicKey,
  );
  const derived = walletFromMnemonic(mnemonic);
  derived.secretKey.dispose();
  if (derived.address !== wallet.publicKey) throw new KeyIntegrityError();
  return mnemonic;
}
