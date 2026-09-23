import { API_IMAGE_CACHE_MAX_BYTES, API_IMAGE_CACHE_TTL_MS } from "@launchbot/shared";
import type { TelegramFile, TelegramFileClient } from "@launchbot/shared/server";

export type TokenImageService = {
  /** The image behind a `file_id`, from memory or from Telegram; throws a TelegramFileError. */
  get: (fileId: string) => Promise<TelegramFile>;
};

export type TokenImageDeps = {
  client: TelegramFileClient;
  /** Proposal: images stay in memory an hour, 50 MB in all, the least recently used out first. */
  maxBytes?: number;
  ttlMs?: number;
  now?: () => number;
};

type Entry = TelegramFile & { storedAt: number };

export function createTokenImageService(deps: TokenImageDeps): TokenImageService {
  const {
    client,
    maxBytes = API_IMAGE_CACHE_MAX_BYTES,
    ttlMs = API_IMAGE_CACHE_TTL_MS,
    now = Date.now,
  } = deps;
  // Insertion order is the recency order: a hit is deleted and set again.
  const entries = new Map<string, Entry>();
  let total = 0;

  function remember(fileId: string, file: TelegramFile): void {
    if (file.bytes.byteLength > maxBytes) return;
    entries.set(fileId, { ...file, storedAt: now() });
    total += file.bytes.byteLength;
    for (const [key, entry] of entries) {
      if (total <= maxBytes) break;
      entries.delete(key);
      total -= entry.bytes.byteLength;
    }
  }

  return {
    async get(fileId) {
      const hit = entries.get(fileId);
      if (hit !== undefined) {
        entries.delete(fileId);
        total -= hit.bytes.byteLength;
        if (now() - hit.storedAt < ttlMs) {
          remember(fileId, hit);
          return { bytes: hit.bytes, contentType: hit.contentType };
        }
      }
      const file = await client.downloadTelegramFile(fileId);
      remember(fileId, file);
      return file;
    },
  };
}
