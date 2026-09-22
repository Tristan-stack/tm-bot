import { decodeBase58 } from "@launchbot/shared";
import { PublicKey } from "@solana/web3.js";

// The base58 rule of an address lives in @launchbot/shared (it validates TREASURY_WALLET too);
// this package re-exports it beside the check that needs the library.
export { isValidSolanaAddress, solanaAddressSchema } from "@launchbot/shared";

const ADDRESS_BYTES = 32;

/**
 * False for a program-derived address (a PDA is not on the ed25519 curve), the case where
 * a withdrawal asks "Continue anyway" (§9.5). False as well for an invalid address.
 */
export function isOnCurve(address: string): boolean {
  const bytes = decodeBase58(address);
  return bytes?.length === ADDRESS_BYTES && PublicKey.isOnCurve(bytes);
}
