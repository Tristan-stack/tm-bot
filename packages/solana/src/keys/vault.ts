import { Keypair } from "@solana/web3.js";
import { decryptSecret, encryptSecret, MASTER_KEY_BYTES } from "./aes-gcm.js";
import { InvalidMasterKeyError, KeyIntegrityError } from "./errors.js";
import { addressOfSecretKey } from "./keypair.js";
import { assertValidMnemonic, normalizeMnemonic } from "./mnemonic.js";

/** Prisma writes its `Bytes` as plain `ArrayBuffer` views: what the vault hands to a row. */
type RowBytes = Uint8Array<ArrayBuffer>;
/** The same columns read back from a row: any view will do. */
type Stored<T> = { [K in keyof T]: Uint8Array };

/** The `Wallet` and `Payment` columns of a secret key. */
export type EncryptedSecret = { encSecretKey: RowBytes; iv: RowBytes; authTag: RowBytes };
/** The `Wallet` columns of a seed phrase (decision of 16/09/2026). */
export type EncryptedMnemonic = {
  encMnemonic: RowBytes;
  mnemonicIv: RowBytes;
  mnemonicAuthTag: RowBytes;
};
export type StoredSecret = Stored<EncryptedSecret>;
export type StoredMnemonic = Stored<EncryptedMnemonic>;

/** Out of Node's buffer pool, into the type Prisma wants. Nothing here is secret. */
const rowBytes = (bytes: Uint8Array): RowBytes => Uint8Array.from(bytes);

/** The signer of the library (D10). It exists inside `withSigner` only. */
export type SolanaSigner = Keypair;

export interface KeyVault {
  /** The 64-byte secret key of `address`, bound to it (AAD, proposal). */
  encrypt(secretKey: Uint8Array, address: string): EncryptedSecret;
  /** The phrase, normalized and validated first, bound to `address` under its own AAD domain. */
  encryptMnemonic(mnemonic: string, address: string): EncryptedMnemonic;
  /**
   * One of the two ways out of the vault (§9.6): the signer lives for the time of `fn`, then
   * the key is zeroed, whether `fn` returned or threw. The signer must not leave `fn`.
   */
  withSigner<T>(
    enc: StoredSecret,
    address: string,
    fn: (signer: SolanaSigner) => Promise<T>,
  ): Promise<T>;
}

/** Domain separation: a mnemonic ciphertext never decrypts as a key, and the reverse. */
const MNEMONIC_AAD_PREFIX = "mnemonic:";

/** The master key lives beside the vault, not on it: no field to log, spread or serialize. */
const masterKeys = new WeakMap<KeyVault, Uint8Array>();

class Vault implements KeyVault {
  constructor(masterKey: Uint8Array) {
    masterKeys.set(this, Uint8Array.from(masterKey));
  }

  encrypt(secretKey: Uint8Array, address: string): EncryptedSecret {
    // A key that does not own the address would be stored, then refused forever.
    if (addressOfSecretKey(secretKey) !== address) throw new KeyIntegrityError();
    const { ciphertext, iv, authTag } = encryptSecret(masterKeyOf(this), secretKey, address);
    return { encSecretKey: rowBytes(ciphertext), iv: rowBytes(iv), authTag: rowBytes(authTag) };
  }

  encryptMnemonic(mnemonic: string, address: string): EncryptedMnemonic {
    const normalized = normalizeMnemonic(mnemonic);
    assertValidMnemonic(normalized);
    const plain = Buffer.from(normalized, "utf8");
    try {
      const sealed = encryptSecret(masterKeyOf(this), plain, MNEMONIC_AAD_PREFIX + address);
      return {
        encMnemonic: rowBytes(sealed.ciphertext),
        mnemonicIv: rowBytes(sealed.iv),
        mnemonicAuthTag: rowBytes(sealed.authTag),
      };
    } finally {
      plain.fill(0);
    }
  }

  async withSigner<T>(
    enc: StoredSecret,
    address: string,
    fn: (signer: SolanaSigner) => Promise<T>,
  ): Promise<T> {
    const secretKey = decryptSecretKey(masterKeyOf(this), enc, address);
    try {
      // Already verified against the address: the library does not check it a second time.
      return await fn(Keypair.fromSecretKey(secretKey, { skipValidation: true }));
    } finally {
      secretKey.fill(0);
    }
  }
}

/** One vault per process, from `env.WALLET_ENCRYPTION_KEY`. The key is copied, never read. */
export function createKeyVault(masterKey: Uint8Array): KeyVault {
  if (masterKey.length !== MASTER_KEY_BYTES) throw new InvalidMasterKeyError();
  return new Vault(masterKey);
}

/** Internal to the package: how `revealWalletSecrets` reads the key without a method. */
export function masterKeyOf(vault: KeyVault): Uint8Array {
  const masterKey = masterKeys.get(vault);
  if (masterKey === undefined) throw new InvalidMasterKeyError();
  return masterKey;
}

/** The 64 bytes of a row, checked against its address (§9.6). The caller zeroes them. */
export function decryptSecretKey(
  masterKey: Uint8Array,
  enc: StoredSecret,
  address: string,
): Uint8Array {
  const secretKey = decryptSecret(
    masterKey,
    { ciphertext: enc.encSecretKey, iv: enc.iv, authTag: enc.authTag },
    address,
  );
  if (addressOfSecretKey(secretKey) !== address) {
    secretKey.fill(0);
    throw new KeyIntegrityError();
  }
  return secretKey;
}

/** The normalized phrase of a row. Its derivation is for the caller to verify. */
export function decryptMnemonic(
  masterKey: Uint8Array,
  enc: StoredMnemonic,
  address: string,
): string {
  const plain = decryptSecret(
    masterKey,
    { ciphertext: enc.encMnemonic, iv: enc.mnemonicIv, authTag: enc.mnemonicAuthTag },
    MNEMONIC_AAD_PREFIX + address,
  );
  // Decoded in place: `Buffer.from(plain)` would leave an unzeroed copy behind.
  const mnemonic = new TextDecoder().decode(plain);
  plain.fill(0);
  return mnemonic;
}
