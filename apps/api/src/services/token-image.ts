import {
  API_IMAGE_CACHE_MAX_ENTRIES,
  API_IMAGE_CACHE_TTL_MS,
  createTtlCache,
} from "@launchbot/shared";
import type { TelegramFile, TelegramFileClient } from "@launchbot/shared/server";

export type TokenImageService = {
  /** The image behind a `file_id`, from memory or from Telegram; throws a TelegramFileError. */
  get: (fileId: string) => Promise<TelegramFile>;
};

/**
 * Proposal: images stay in memory an hour, ten at most (50 MB with the 5 MB cap), the least
 * recently stored out first; concurrent requests for one `file_id` share a single download,
 * and a failed one is not kept.
 */
export function createTokenImageService(client: TelegramFileClient): TokenImageService {
  const cache = createTtlCache<string, TelegramFile>({
    ttlMs: API_IMAGE_CACHE_TTL_MS,
    maxEntries: API_IMAGE_CACHE_MAX_ENTRIES,
  });
  return { get: (fileId) => cache.get(fileId, () => client.downloadTelegramFile(fileId)) };
}
