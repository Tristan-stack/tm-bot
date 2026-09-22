import { randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { SecretBytes } from "./secret-bytes.js";

/** ed25519 seed ‖ public key: the format of `Keypair.fromSecretKey` and of a Phantom export. */
export const SECRET_KEY_BYTES = 64;
export const SEED_BYTES = 32;

export type GeneratedKeypair = { address: string; secretKey: SecretBytes };

export type ImportFailureReason =
  | "invalid_base58"
  | "invalid_length"
  | "public_key_mismatch"
  | "invalid_word_count"
  | "invalid_mnemonic";

/** What V1-12 stores: the reason of a failure stays internal, the user reads one fixed text. */
export type ImportResult =
  | {
      ok: true;
      address: string;
      secretKey: SecretBytes;
      derivationPath: string | null;
      mnemonic: string | null;
    }
  | { ok: false; reason: ImportFailureReason };

/** The keypair of a 32-byte seed. The seed is zeroed. */
export function keypairFromSeed(seed: Uint8Array): GeneratedKeypair {
  const keypair = Keypair.fromSeed(seed);
  seed.fill(0);
  return { address: keypair.publicKey.toBase58(), secretKey: SecretBytes.take(keypair.secretKey) };
}

/** A keypair with no mnemonic: deposit addresses (V1-28), mints (V2-03). */
export function generateKeypair(): GeneratedKeypair {
  return keypairFromSeed(randomBytes(SEED_BYTES));
}

/**
 * The address of a 64-byte secret key, or null when its public half is not the one derived
 * from its seed: a corrupted or forged key never signs for an address it does not own.
 */
export function addressOfSecretKey(secretKey: Uint8Array): string | null {
  if (secretKey.length !== SECRET_KEY_BYTES) return null;
  try {
    return Keypair.fromSecretKey(secretKey).publicKey.toBase58();
  } catch {
    return null;
  }
}
