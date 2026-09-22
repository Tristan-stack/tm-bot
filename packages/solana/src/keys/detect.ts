import { decodeBase58 } from "@launchbot/shared";
import { SECRET_KEY_BYTES } from "./keypair.js";
import { ENGLISH_WORDS, normalizeMnemonic } from "./mnemonic.js";

/** Proposal: the thresholds of the heuristics. A 64-byte key is 86 to 88 characters of base58. */
const PRIVATE_KEY_BASE58_LENGTH = { min: 80, max: 90 } as const;
/** A phrase is at least 12 consecutive words, one typo tolerated. */
const SEED_PHRASE_WINDOW = 12;
const SEED_PHRASE_MIN_MATCHES = 11;

const WHITESPACE = /\s+/;
/** The `[12,34,…]` export of solana-keygen. */
const JSON_ARRAY = /\[[\d\s,]+\]/g;

/**
 * For the middleware of V1-12, which deletes such a message: a base58 token of 64 bytes, or a
 * JSON array of 64 bytes. A transaction signature is an accepted false positive; a 32-byte
 * address is never detected. Pure: the text is not logged.
 */
export function looksLikePrivateKey(text: string): boolean {
  for (const token of text.split(WHITESPACE)) {
    const { min, max } = PRIVATE_KEY_BASE58_LENGTH;
    if (token.length < min || token.length > max) continue;
    if (decodeBase58(token)?.length === SECRET_KEY_BYTES) return true;
  }
  for (const array of text.match(JSON_ARRAY) ?? []) {
    const numbers = array.slice(1, -1).split(",").map(Number);
    const isByte = (n: number) => Number.isInteger(n) && n >= 0 && n <= 255;
    if (numbers.length === SECRET_KEY_BYTES && numbers.every(isByte)) return true;
  }
  return false;
}

/**
 * At least 11 of 12 consecutive words in the English BIP39 wordlist. Everyday English does
 * not trigger it: "the", "and", "is" are not in the list.
 */
export function looksLikeSeedPhrase(text: string): boolean {
  // The same normalization as an import, so the two cannot drift.
  const words = normalizeMnemonic(text).split(" ");
  let matches = 0;
  for (let i = 0; i < words.length; i++) {
    if (ENGLISH_WORDS.has(words[i] ?? "")) matches++;
    // The window slides: the word that leaves it no longer counts.
    if (i >= SEED_PHRASE_WINDOW && ENGLISH_WORDS.has(words[i - SEED_PHRASE_WINDOW] ?? "")) {
      matches--;
    }
    if (i >= SEED_PHRASE_WINDOW - 1 && matches >= SEED_PHRASE_MIN_MATCHES) return true;
  }
  return false;
}
