const encoder = new TextEncoder();

/** Telegram and Metaplex limits are in bytes: `utf8ByteLength("🚀")` is 4. */
export const utf8ByteLength = (text: string): number => encoder.encode(text).length;

/** `7xKX…gAsU`. The mint of channel posts uses 6 / 4: `OTTRk3…9fQ2`. */
export function shortAddress(address: string, head = 4, tail = 4): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
