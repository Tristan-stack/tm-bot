const encoder = new TextEncoder();

/** Telegram and Metaplex limits are in bytes: `utf8ByteLength("🚀")` is 4. */
export const utf8ByteLength = (text: string): number => encoder.encode(text).length;

/** Code points, not UTF-16 units: `codePointLength("🚀")` is 1 (a wallet name, a description). */
export const codePointLength = (text: string): number => Array.from(text).length;

/** Trimmed, one space between words. Line breaks are not spaces here: the caller decides. */
export const collapseSpaces = (text: string): string => text.trim().replace(/ {2,}/g, " ");

/** Any control character (`\p{Cc}`): a line break, a tab, a NUL… refused by every input. */
export const hasControlChars = (text: string): boolean => /\p{Cc}/u.test(text);

/** `7xKX…gAsU`. The mint of channel posts uses 6 / 4: `OTTRk3…9fQ2`. */
export function shortAddress(address: string, head = 4, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
