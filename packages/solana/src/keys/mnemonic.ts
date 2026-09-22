import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { InvalidMnemonicError } from "./errors.js";
import { keypairFromSeed } from "./keypair.js";
import type { GeneratedKeypair, ImportFailureReason, ImportResult } from "./keypair.js";
import { redacted } from "./secret-bytes.js";
import { deriveEd25519Seed } from "./slip10.js";

/** First account of BIP44 coin type 501: the address Phantom and Solflare show for a phrase. */
export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
/** 12 or 24 words only (§9.4): 15, 18 and 21 are valid BIP39 but refused. */
const MNEMONIC_WORD_COUNTS: readonly number[] = [12, 24];
const TWELVE_WORDS_ENTROPY_BITS = 128;

/** The English BIP39 wordlist, for the heuristics of V1-12. */
export const ENGLISH_WORDS: ReadonlySet<string> = new Set(wordlist);

export type MnemonicWallet = GeneratedKeypair & { mnemonic: string; derivationPath: string };

/** NFKD, lower case, one space between words: the form that is stored and compared. */
export function normalizeMnemonic(text: string): string {
  return text.normalize("NFKD").toLowerCase().trim().split(/\s+/).join(" ");
}

/** null when the normalized phrase is 12 or 24 English words with a valid checksum. */
export function mnemonicIssue(normalized: string): ImportFailureReason | null {
  if (!MNEMONIC_WORD_COUNTS.includes(normalized.split(" ").length)) return "invalid_word_count";
  return validateMnemonic(normalized, wordlist) ? null : "invalid_mnemonic";
}

export function assertValidMnemonic(normalized: string): void {
  if (mnemonicIssue(normalized) !== null) throw new InvalidMnemonicError();
}

/**
 * The account of a valid normalized phrase at `path`, without BIP39 passphrase (a "25th word"
 * would give another address than Phantom). PBKDF2 takes tens of milliseconds: never inside
 * a locked transaction. The BIP39 seed and the derived key are zeroed.
 */
export function walletFromMnemonic(
  normalized: string,
  path: string = SOLANA_DERIVATION_PATH,
): GeneratedKeypair {
  const seed = mnemonicToSeedSync(normalized);
  const key = deriveEd25519Seed(seed, path);
  seed.fill(0);
  return keypairFromSeed(key);
}

/** A new 12-word wallet (decision of 16/09/2026), CSPRNG entropy. */
export function generateMnemonicWallet(): MnemonicWallet {
  const mnemonic = generateMnemonic(wordlist, TWELVE_WORDS_ENTROPY_BITS);
  return redacted({
    mnemonic,
    ...walletFromMnemonic(mnemonic),
    derivationPath: SOLANA_DERIVATION_PATH,
  });
}

/** Import of a seed phrase (§9.4): the phrase comes back normalized, ready to be encrypted. */
export function parseSeedPhrase(input: string): ImportResult {
  const mnemonic = normalizeMnemonic(input);
  const reason = mnemonicIssue(mnemonic);
  if (reason !== null) return { ok: false, reason };
  return redacted({
    ok: true,
    ...walletFromMnemonic(mnemonic),
    derivationPath: SOLANA_DERIVATION_PATH,
    mnemonic,
  });
}
