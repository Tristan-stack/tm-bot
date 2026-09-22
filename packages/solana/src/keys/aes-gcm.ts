import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KeyDecryptionError } from "./errors.js";

export const MASTER_KEY_BYTES = 32;
export const IV_BYTES = 12;
export const AUTH_TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

/** Node-native views in and out: the vault shapes them for the rows. */
export type Sealed = { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array };

/**
 * AES-256-GCM (NIST SP 800-38D) of one secret. A fresh random IV every call: GCM never
 * survives a repeated (key, IV) pair. The AAD binds the ciphertext to its row, so a value
 * copied onto another row no longer decrypts.
 */
export function encryptSecret(masterKey: Uint8Array, plain: Uint8Array, aad: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/**
 * The plaintext, which the caller zeroes once used. Any failure (tag, IV, master key, AAD,
 * wrong sizes) is the same generic error: nothing about the bytes leaks through it.
 */
export function decryptSecret(masterKey: Uint8Array, sealed: Sealed, aad: string): Uint8Array {
  const { ciphertext, iv, authTag } = sealed;
  // Checked before setAuthTag: Node would accept a truncated tag as a shorter tag length.
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) throw new KeyDecryptionError();
  // Produced before the tag is verified: zeroed whether the verification passes or not.
  let head: Buffer | undefined;
  try {
    const decipher = createDecipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);
    head = decipher.update(ciphertext);
    // `final` is what verifies the tag: the plaintext is not trusted before it returns.
    const tail = decipher.final();
    const plain = Buffer.concat([head, tail]);
    tail.fill(0);
    return plain;
  } catch {
    throw new KeyDecryptionError();
  } finally {
    head?.fill(0);
  }
}
