import bs58 from "bs58";
import { z } from "zod";

/** Bitcoin alphabet: no `0`, `O`, `I` or `l`. */
export const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** The bytes of a text that is base58 as a whole, else null. No trim: the caller decides. */
export function decodeBase58(text: string): Uint8Array | null {
  if (!BASE58_PATTERN.test(text)) return null;
  try {
    return bs58.decode(text);
  } catch {
    return null;
  }
}

const ADDRESS_BYTES = 32;
/** The base58 of 32 bytes is 32 to 44 characters long. */
const ADDRESS_LENGTH = { min: 32, max: 44 } as const;

/**
 * A base58 Solana public key (§9.5): the one rule for a typed address, `TREASURY_WALLET` and
 * the Mini App alike. No trim: a value with spaces around is not an address. Whether the
 * key is on the ed25519 curve is `isOnCurve` of @launchbot/solana (it needs the library).
 */
export function isValidSolanaAddress(value: string): boolean {
  if (value.length < ADDRESS_LENGTH.min || value.length > ADDRESS_LENGTH.max) return false;
  return decodeBase58(value)?.length === ADDRESS_BYTES;
}

/** For user input: trims first, then requires a valid address. */
export const solanaAddressSchema: z.ZodType<string> = z
  .string()
  .trim()
  .refine(isValidSolanaAddress, { message: "Invalid Solana address" });
