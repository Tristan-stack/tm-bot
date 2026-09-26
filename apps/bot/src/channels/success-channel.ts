import { setTimeout as delay } from "node:timers/promises";
import {
  formatSuccessPost,
  successPostInputSchema,
  TOKEN_IMAGE_MAX_BYTES,
} from "@launchbot/shared";
import type { SolanaCluster, SuccessPostInput } from "@launchbot/shared";
import { createLogger, createTelegramFileClient } from "@launchbot/shared/server";
import type { Env } from "@launchbot/shared/server";
import { InputFile } from "grammy";
import type { Api } from "grammy";
import { retryAfterMs, sendFailureOf, telegramErrorFields } from "../navigation/telegram-errors.js";

const log = createLogger("bot:success-post");

/**
 * Publishes one confirmed launch in the Success channel (V1-39). No V1 flow calls it:
 * V2-04 will, after checking `channelMessageId === null`. Not idempotent.
 * A failure here is the caller's to absorb: the launch is already confirmed on-chain.
 */

export class SuccessPostError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "SuccessPostError";
    this.reason = reason;
  }
}

export type SuccessChannelApi = Pick<Api, "sendPhoto" | "sendMessage" | "getFile">;

export type SuccessChannelDeps = {
  channelId: string;
  cluster: SolanaCluster;
  /** Absent when the variable is unset. Required unless `onMissingImage` is `"text"`. */
  defaultImageUrl?: string;
  /**
   * `"error"`: a launch with no usable image and no `DEFAULT_TOKEN_IMAGE_URL` throws.
   * `"text"`: the preview's `--no-image`, a text post on purpose.
   */
  onMissingImage?: "error" | "text";
  /** The bytes of a Telegram file. The file URL holds BOT_TOKEN and never leaves the client. */
  downloadFile: (fileId: string) => Promise<Uint8Array>;
  sleep?: (ms: number) => Promise<unknown>;
};

export type PreviewArgs = {
  chatId: string;
  noImage: boolean;
  noLinks: boolean;
  longDescription: boolean;
};

/** `undefined` when the command line is not the preview usage. */
export function parsePreviewArgs(argv: readonly string[]): PreviewArgs | undefined {
  let chatId: string | undefined;
  let noImage = false;
  let noLinks = false;
  let longDescription = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    // pnpm forwards the `--` that separates its own options from the script's.
    if (arg === "--") continue;
    if (arg === "--no-image") noImage = true;
    else if (arg === "--no-links") noLinks = true;
    else if (arg === "--long-description") longDescription = true;
    else if (arg === "--chat") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return undefined;
      chatId = value;
      index += 1;
    } else return undefined;
  }
  if (chatId === undefined || chatId === "") return undefined;
  return { chatId, noImage, noLinks, longDescription };
}

export function successChannelDeps(
  env: Pick<Env, "BOT_TOKEN" | "CHANNEL_SUCCESS_ID" | "DEFAULT_TOKEN_IMAGE_URL" | "SOLANA_CLUSTER">,
): SuccessChannelDeps {
  const files = createTelegramFileClient({
    botToken: env.BOT_TOKEN,
    maxBytes: TOKEN_IMAGE_MAX_BYTES,
  });
  return {
    channelId: env.CHANNEL_SUCCESS_ID,
    cluster: env.SOLANA_CLUSTER,
    ...(env.DEFAULT_TOKEN_IMAGE_URL === undefined
      ? {}
      : { defaultImageUrl: env.DEFAULT_TOKEN_IMAGE_URL }),
    downloadFile: async (fileId) => (await files.downloadTelegramFile(fileId)).bytes,
  };
}

function validationError(path: PropertyKey | undefined): SuccessPostError {
  if (path === "launchStatus") {
    return new SuccessPostError("Only a confirmed launch can be posted");
  }
  if (path === "devTokens") return new SuccessPostError("The dev token amount is required");
  if (path === "mint") return new SuccessPostError("The mint address is invalid");
  if (path === "txSignature") {
    return new SuccessPostError("The transaction signature is required");
  }
  return new SuccessPostError("The launch cannot be posted");
}

function failureError(error: unknown): SuccessPostError {
  const failure = sendFailureOf(error);
  if (failure === "cant_post") {
    return new SuccessPostError("The bot cannot post in the Success channel");
  }
  if (failure === "rate_limited") {
    return new SuccessPostError("Telegram rate-limited the Success channel post");
  }
  return new SuccessPostError("The Success channel post failed");
}

const isChannelFailure = (error: unknown): boolean => {
  const failure = sendFailureOf(error);
  return failure === "cant_post" || failure === "rate_limited";
};

/**
 * Validates, formats and posts. Returns the `message_id` (the future `Launch.channelMessageId`).
 * Image order: `file_id`, then the file downloaded and sent again, then `DEFAULT_TOKEN_IMAGE_URL`,
 * then the same caption as a text message. A 429 is tried once more after `retry_after`.
 */
export async function publishToSuccessChannel(
  api: SuccessChannelApi,
  input: SuccessPostInput,
  deps: SuccessChannelDeps,
): Promise<{ messageId: number }> {
  const parsed = successPostInputSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.path[0]);

  const post = formatSuccessPost(parsed.data, deps.cluster);
  const sleep = deps.sleep ?? delay;
  const onMissingImage = deps.onMissingImage ?? "error";
  let imageError: unknown;

  const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      const wait = retryAfterMs(error);
      if (wait === undefined) throw error;
      await sleep(wait);
      return await run();
    }
  };

  const sendPhoto = (photo: string | InputFile) =>
    withRetry(() =>
      api.sendPhoto(deps.channelId, photo, { caption: post.caption, parse_mode: "HTML" }),
    );

  const attempt = async (
    run: () => Promise<{ message_id: number }>,
  ): Promise<number | undefined> => {
    try {
      return (await run()).message_id;
    } catch (error) {
      if (isChannelFailure(error)) throw failureError(error);
      imageError = error;
      return undefined;
    }
  };

  const finish = (messageId: number): { messageId: number } => {
    log.info({ mint: parsed.data.mint, messageId }, "success_post.published");
    return { messageId };
  };

  const loadUploaded = async (id: string): Promise<InputFile | undefined> => {
    try {
      const file = await withRetry(() => api.getFile(id));
      const path = file.file_path;
      if (path === undefined || path === "") throw new Error("Telegram file has no path");
      if (file.file_size !== undefined && file.file_size > TOKEN_IMAGE_MAX_BYTES) {
        throw new Error("Telegram file is too large");
      }
      const bytes = await deps.downloadFile(id);
      if (bytes.byteLength > TOKEN_IMAGE_MAX_BYTES) throw new Error("Telegram file is too large");
      return new InputFile(Uint8Array.from(bytes), "token.jpg");
    } catch (error) {
      // A 403 here is the file, not the channel: the default image can still be posted.
      if (sendFailureOf(error) === "rate_limited") throw failureError(error);
      imageError = error;
      return undefined;
    }
  };

  const fileId = post.photo.fileId;
  if (fileId !== undefined) {
    const posted = await attempt(() => sendPhoto(fileId));
    if (posted !== undefined) return finish(posted);
    const uploaded = await loadUploaded(fileId);
    if (uploaded !== undefined) {
      const postedFile = await attempt(() => sendPhoto(uploaded));
      if (postedFile !== undefined) return finish(postedFile);
    }
  }

  const defaultImageUrl = deps.defaultImageUrl;
  if (defaultImageUrl !== undefined) {
    const posted = await attempt(() => sendPhoto(defaultImageUrl));
    if (posted !== undefined) return finish(posted);
  } else if (onMissingImage === "error") {
    throw new SuccessPostError("DEFAULT_TOKEN_IMAGE_URL is not set");
  }

  if (imageError !== undefined) {
    log.error(
      { mint: parsed.data.mint, ...telegramErrorFields(imageError) },
      "success_post.image_failed",
    );
  }
  try {
    const sent = await withRetry(() =>
      api.sendMessage(deps.channelId, post.caption, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
    );
    return finish(sent.message_id);
  } catch (error) {
    throw failureError(error);
  }
}
