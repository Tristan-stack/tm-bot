import { autoRetry } from "@grammyjs/auto-retry";
import type { Screen } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { Api, GrammyError } from "grammy";

const log = createLogger("worker:telegram");

/**
 * Why a message did not go: the user blocked the bot or never started it (no retry), Telegram
 * still asks to wait after the automatic retries, or anything else (network, 5xx).
 */
export type SendFailure = "BLOCKED" | "CHAT_NOT_FOUND" | "RATE_LIMITED" | "ERROR";
export type SendResult = { ok: true; messageId: number } | { ok: false; reason: SendFailure };

/** A failure that will not pass: retrying would send nothing either. */
export const isUndeliverable = (reason: SendFailure): boolean =>
  reason === "BLOCKED" || reason === "CHAT_NOT_FOUND";

export type TelegramSender = {
  /** A new message in the private chat of a user: the worker knows no screen of the bot. */
  sendScreen: (telegramId: bigint, screen: Screen) => Promise<SendResult>;
  /** To every `ADMIN_TELEGRAM_IDS`; one that never started the bot does not stop the others. */
  notifyAdmins: (screen: Screen) => Promise<void>;
};

export function sendFailureOf(error: unknown): SendFailure {
  if (!(error instanceof GrammyError)) return "ERROR";
  if (error.error_code === 403) return "BLOCKED";
  if (error.error_code === 429) return "RATE_LIMITED";
  if (error.error_code === 400 && /chat not found/i.test(error.description)) {
    return "CHAT_NOT_FOUND";
  }
  return "ERROR";
}

/**
 * The Bot API without the bot: `new Api(token)`, never `bot.start()` nor `getUpdates` — a
 * second poller would make Telegram answer 409 to the bot. 429 waits `retry_after`, within
 * bounds: a job can wait longer than a click.
 */
export function createTelegramApi(botToken: string): Api {
  const api = new Api(botToken);
  api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
  return api;
}

export function createTelegramSender(deps: {
  api: Pick<Api, "sendMessage">;
  adminIds: readonly number[];
}): TelegramSender {
  const { api, adminIds } = deps;

  async function send(chatId: string, screen: Screen): Promise<SendResult> {
    const { text, ...rest } = screen;
    try {
      const message = await api.sendMessage(chatId, text, rest);
      return { ok: true, messageId: message.message_id };
    } catch (error) {
      const reason = sendFailureOf(error);
      // Scrubbed by the logger: a network error of grammY can quote the URL of the token.
      if (isUndeliverable(reason)) log.info({ chatId, reason }, "telegram.undeliverable");
      else log.warn({ err: error, chatId, reason }, "telegram.send_failed");
      return { ok: false, reason };
    }
  }

  return {
    // A Telegram id exceeds int4, not 2^53: sent as a string, as the API accepts it.
    sendScreen: (telegramId, screen) => send(telegramId.toString(), screen),

    async notifyAdmins(screen) {
      if (adminIds.length === 0) log.warn("telegram.no_admin");
      for (const id of adminIds) await send(String(id), screen);
    },
  };
}
