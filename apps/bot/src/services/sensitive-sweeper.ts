import type { SensitiveMessageStore } from "@launchbot/db";
import { en, SENSITIVE_SWEEP_BATCH_SIZE } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { GrammyError } from "grammy";
import type { Api } from "grammy";
import { isAlreadyDeleted, telegramErrorFields } from "../navigation/telegram-errors.js";

const log = createLogger("bot:sensitive");

export type SweepReport = { deleted: number; undeletable: number; retried: number };

/**
 * What a refused deletion means for its row (V1-43): already gone; never deletable (older than
 * 48 h, rights lost, the chat blocked); Telegram asks to wait (after the retries of `autoRetry`);
 * or a failure that may pass (network, 5xx), tried again at the next pass.
 */
function outcomeOf(error: unknown): "gone" | "undeletable" | "later" | "retry" {
  if (!(error instanceof GrammyError)) return "retry";
  if (error.error_code === 429) return "later";
  if (error.error_code >= 500) return "retry";
  return isAlreadyDeleted(error) ? "gone" : "undeletable";
}

/**
 * One pass of the sweeper of the bot: the messages holding wallet keys whose 60 s are over, 50 at
 * most, deleted in order. A message that can no longer be deleted gets a reply that says so, so
 * the admin deletes it by hand. Nothing of a message is logged, and never `GrammyError.payload`.
 */
export async function sweepSensitiveMessages(deps: {
  store: Pick<SensitiveMessageStore, "listDue" | "remove" | "retryLater">;
  api: Pick<Api, "deleteMessage" | "sendMessage">;
  now?: () => Date;
}): Promise<SweepReport> {
  const { store, api, now = () => new Date() } = deps;
  const report: SweepReport = { deleted: 0, undeletable: 0, retried: 0 };
  for (const row of await store.listDue(now(), SENSITIVE_SWEEP_BATCH_SIZE)) {
    const chatId = row.chatId.toString();
    try {
      await api.deleteMessage(chatId, row.messageId);
      await store.remove(row.id);
      report.deleted += 1;
      continue;
    } catch (error) {
      const outcome = outcomeOf(error);
      const logged = { chatId, messageId: row.messageId, ...telegramErrorFields(error) };
      if (outcome === "gone") {
        await store.remove(row.id);
        report.deleted += 1;
      } else if (outcome === "retry") {
        await store.retryLater(row.id);
        report.retried += 1;
        log.warn({ ...logged, attempts: row.attempts + 1 }, "sensitive.delete_retry");
      } else if (outcome === "undeletable") {
        await store.remove(row.id);
        report.undeletable += 1;
        log.error(logged, "sensitive.not_deleted");
        await api
          .sendMessage(chatId, en.admin.getall.notDeleted, {
            reply_parameters: { message_id: row.messageId, allow_sending_without_reply: true },
          })
          .catch(() => undefined);
      }
      // `later`: the row waits for the next pass.
    }
  }
  return report;
}
