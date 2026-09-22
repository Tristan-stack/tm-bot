/**
 * Errors of the wallet keys. None of them carries a byte, a phrase or a `cause` holding one:
 * the message is fixed, and the logger of @launchbot/shared keeps a name and a message only.
 */

/** `WALLET_ENCRYPTION_KEY` does not decode to 32 bytes: the vault refuses to exist. */
export class InvalidMasterKeyError extends Error {
  constructor() {
    super("The wallet master key must be exactly 32 bytes.");
    this.name = "InvalidMasterKeyError";
  }
}

/** Wrong tag, IV, master key or AAD: the ciphertext is refused as a whole (§9.6). */
export class KeyDecryptionError extends Error {
  constructor() {
    super("Wallet key decryption failed.");
    this.name = "KeyDecryptionError";
  }
}

/** The decrypted material does not belong to the address the row claims. */
export class KeyIntegrityError extends Error {
  constructor() {
    super("Wallet key does not match its address.");
    this.name = "KeyIntegrityError";
  }
}

/** Not 12 or 24 words of the English wordlist with a valid checksum. */
export class InvalidMnemonicError extends Error {
  constructor() {
    super("Invalid mnemonic.");
    this.name = "InvalidMnemonicError";
  }
}
