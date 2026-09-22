// Test only, not exported by the package. Public phrases of the BIP39 test vectors: they never
// receive funds. Addresses computed by this package, then cross-checked on 2026-09-22 with an
// independent implementation (ed25519-hd-key + bip39); the 12-word one is the address Phantom
// shows for this phrase.

const words = (word: string, count: number, last: string) => `${`${word} `.repeat(count)}${last}`;

export const TWELVE_WORDS = words("abandon", 11, "about");
export const TWELVE_WORDS_ADDRESS = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";
export const TWENTY_FOUR_WORDS = words("abandon", 23, "art");
export const TWENTY_FOUR_WORDS_ADDRESS = "3Cy3YNTFywCmxoxt8n7UH6hg6dLo5uACowX3CFceaSnx";
/** The 12-word phrase one level up (3 segments): what a wrong path would import. */
export const TWELVE_WORDS_ACCOUNT_LEVEL_ADDRESS = "GjJyeC1r2RgkuoCWMyPYkCWSGSGLcz266EaAkLA27AhL";

/** Phrases `mnemonicIssue` refuses, by reason. */
export const INVALID_PHRASES = {
  thirteenWords: words("abandon", 12, "about"),
  fifteenWords: words("abandon", 14, "about"),
  wrongChecksum: words("abandon", 11, "abandon"),
  unknownWord: words("abandon", 11, "abandonment"),
} as const;
