import { setTimeout as delay } from "node:timers/promises";
import { ANNOUNCE_RETRY_MAX_WAIT_MS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { Api } from "grammy";
import type { AnnounceContent, AnnounceResult } from "../../context.js";
import {
  retryAfterMs,
  sendFailureOf,
  telegramErrorFields,
} from "../../navigation/telegram-errors.js";

const log = createLogger("bot:admin:announce");

export type AnnounceApi = Pick<Api, "sendMessage" | "sendPhoto">;

/**
 * Sends the message of the admin as it came (§3, V1-38): its entities, its link preview options,
 * **no `parse_mode`**, so nothing is read twice. The preview to the admin and every post go
 * through here: the preview is the post.
 */
export async function sendAnnouncement(
  api: AnnounceApi,
  chatId: number | string,
  content: AnnounceContent,
): Promise<number> {
  if (content.kind === "text") {
    const sent = await api.sendMessage(chatId, content.text, {
      ...(content.entities === undefined ? {} : { entities: content.entities }),
      ...(content.linkPreview === undefined ? {} : { link_preview_options: content.linkPreview }),
    });
    return sent.message_id;
  }
  const sent = await api.sendPhoto(chatId, content.fileId, {
    caption: content.caption,
    ...(content.captionEntities === undefined ? {} : { caption_entities: content.captionEntities }),
  });
  return sent.message_id;
}

/**
 * One post in one channel. A 429 is sent again once after its `retry_after` when that wait is
 * `ANNOUNCE_RETRY_MAX_WAIT_MS` at most (`autoRetry` already took the short ones); any other
 * failure is final. Never throws: a failure is a result, logged without the text sent.
 */
export async function postAnnouncement(
  api: AnnounceApi,
  chatId: string,
  content: AnnounceContent,
  sleep: (ms: number) => Promise<unknown> = delay,
): Promise<AnnounceResult> {
  const attempt = async (): Promise<AnnounceResult> => ({
    ok: true,
    messageId: await sendAnnouncement(api, chatId, content),
  });
  try {
    return await attempt();
  } catch (error) {
    const wait = retryAfterMs(error);
    if (wait === undefined || wait > ANNOUNCE_RETRY_MAX_WAIT_MS) return failed(chatId, error);
    await sleep(wait);
    try {
      return await attempt();
    } catch (retryError) {
      return failed(chatId, retryError);
    }
  }
}

function failed(chatId: string, error: unknown): AnnounceResult {
  const reason = sendFailureOf(error);
  log.warn({ chatId, reason, ...telegramErrorFields(error) }, "announce.post_failed");
  return { ok: false, reason };
}
