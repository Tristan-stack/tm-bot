import { decodeBase58 } from "@launchbot/shared";
import { addressOfSecretKey, SECRET_KEY_BYTES } from "./keypair.js";
import type { ImportResult } from "./keypair.js";
import { SecretBytes } from "./secret-bytes.js";

/**
 * Import of a private key (§9.4): the base58 of 64 bytes that Phantom and Solflare export.
 * Spaces around are ignored, nothing inside is. The `[12,34,…]` array of solana-keygen is
 * refused, like a 32-byte address.
 */
export function parsePrivateKey(input: string): ImportResult {
  const bytes = decodeBase58(input.trim());
  if (bytes === null) return { ok: false, reason: "invalid_base58" };
  if (bytes.length !== SECRET_KEY_BYTES) return { ok: false, reason: "invalid_length" };
  const address = addressOfSecretKey(bytes);
  if (address === null) {
    bytes.fill(0);
    return { ok: false, reason: "public_key_mismatch" };
  }
  // The secret key is a SecretBytes, which prints [REDACTED] by itself; the rest is public.
  return {
    ok: true,
    address,
    secretKey: SecretBytes.take(bytes),
    derivationPath: null,
    mnemonic: null,
  };
}
