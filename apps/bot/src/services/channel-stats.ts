import { CACHE_TTL_MS, createLastKnownValue, MINUTE_MS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { Api } from "grammy";
import { readTimeout } from "./telegram-timeout.js";

const log = createLogger("bot:channel-stats");

/**
 * Members of the channel of the bot, for the home screen (§4.3): cached 10 min for everyone.
 * When Telegram fails, the last known count is served, however old (`null` if there is none),
 * and Telegram is asked again a minute later, not on every home screen.
 */
export function createChannelMemberCounter(deps: {
  api: Pick<Api, "getChatMemberCount">;
  channelId: string;
  now?: () => number;
}): () => Promise<number | null> {
  const { api, channelId, now } = deps;
  const read = createLastKnownValue({
    ttlMs: CACHE_TTL_MS.channelMembers,
    // Proposal.
    failureTtlMs: MINUTE_MS,
    now,
    load: () => api.getChatMemberCount(channelId, readTimeout()),
    onFailure: (error) => log.warn({ err: error }, "Channel member count failed"),
  });
  return async () => (await read())?.value ?? null;
}
