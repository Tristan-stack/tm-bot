import type { SensitiveMessageStore, SupportDataService, WalletSecretsData } from "@launchbot/db";
import {
  E,
  en,
  GETALL_PROTECT_CONTENT,
  GETALL_REVEAL_TTL_MS,
  SENSITIVE_MESSAGE_TTL_MS,
} from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { revealWalletSecrets } from "@launchbot/solana";
import type { KeyVault, WalletSecrets } from "@launchbot/solana";
import { GrammyError } from "grammy";
import type { BotContext } from "../../context.js";
import { acknowledge, notify } from "../../navigation/notify.js";
import { dropKeyboard } from "../../navigation/show-screen.js";
import { renderAdminNotice, renderAdminUserNotFound } from "./common.js";
import type { AdminKit } from "./common.js";
import { buildWalletKeysMessages } from "./user-data-screens.js";

// Reveal keys of /getall (§11.4, decision of 16/09/2026): the only module that imports
// `revealWalletSecrets` (ESLint), and the only place a stored key is decrypted to be shown. The
// keys go into messages deleted 60 s after their send; never into a log, a session or a button.

const log = createLogger("bot:admin:reveal");

export type RevealDeps = {
  kit: AdminKit;
  support: Pick<SupportDataService, "findUserById" | "walletSecrets">;
  sensitive: Pick<SensitiveMessageStore, "schedule">;
  /** The one vault of the process. */
  vault: KeyVault;
  now: () => Date;
};

/** Telegram's answer to a failed send, never its payload: the payload holds the keys. */
const sendError = (error: unknown) =>
  error instanceof GrammyError
    ? { errorCode: error.error_code, description: error.description }
    : { error: error instanceof Error ? error.name : "unknown" };

export function createReveal(deps: RevealDeps) {
  const { kit, support, sensitive, vault, now } = deps;
  const { ui } = kit;
  const notice = (ctx: BotContext, text: string) =>
    kit.reply(ctx, renderAdminNotice(ui, "getall", text));

  /** `null` when the row does not decrypt: the message says so for that wallet. */
  function secretsOf(row: WalletSecretsData): WalletSecrets | null {
    try {
      const secrets = revealWalletSecrets(row, vault);
      if (secrets.mnemonic === null && row.source !== "IMPORTED_KEY") {
        log.warn({ walletId: row.id }, "admin.getall.seed_missing");
      }
      return secrets;
    } catch (error) {
      log.error({ walletId: row.id, err: error }, "admin.getall.decrypt_failed");
      return null;
    }
  }

  /** One part, then its deletion recorded at once: `false` when either failed. */
  async function sendPart(ctx: BotContext, chatId: number, part: string): Promise<boolean> {
    let messageId: number;
    try {
      ({ message_id: messageId } = await ctx.api.sendMessage(chatId, part, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        protect_content: GETALL_PROTECT_CONTENT,
      }));
    } catch (error) {
      log.error(sendError(error), "admin.getall.send_failed");
      return false;
    }
    try {
      await sensitive.schedule(
        BigInt(chatId),
        messageId,
        new Date(now().getTime() + SENSITIVE_MESSAGE_TTL_MS),
      );
      return true;
    } catch (error) {
      // Without its row nothing would delete it: it goes now, best effort.
      log.error({ err: error }, "admin.getall.schedule_failed");
      await ctx.api.deleteMessage(chatId, messageId).catch(() => undefined);
      return false;
    }
  }

  return {
    /** 🔑 Reveal keys (`adm:ga:rev:<nonce>`): once, within 5 minutes of its /getall. */
    async reveal(ctx: BotContext, nonce: string): Promise<unknown> {
      const request = ctx.session.getallReveal;
      // One use: read and gone, whatever comes next.
      delete ctx.session.getallReveal;
      await dropKeyboard(ctx, ctx.callbackQuery?.message?.message_id);
      if (request?.nonce !== nonce || now().getTime() - request.createdAt >= GETALL_REVEAL_TTL_MS) {
        await notify(ctx, en.admin.getall.expired, { alert: true });
        return notice(ctx, `${E.expired} ${en.admin.getall.expired}`);
      }
      // The client stops waiting: the keys take a few messages.
      await acknowledge(ctx);

      const [user, rows] = await Promise.all([
        support.findUserById(request.targetUserId),
        support.walletSecrets(request.targetUserId),
      ]);
      if (user === null) {
        return kit.reply(ctx, renderAdminUserNotFound(ui, "getall", request.targetTelegramId));
      }
      if (rows.length === 0) return notice(ctx, en.admin.getall.noWalletToReveal);

      const parts = buildWalletKeysMessages(ui, {
        user,
        wallets: rows.map((row) => ({
          name: row.name,
          publicKey: row.publicKey,
          source: row.source,
          secrets: secretsOf(row),
        })),
      });
      const chatId = ctx.chatId;
      if (chatId === undefined) return;
      for (const part of parts) {
        // The parts left are dropped: an admin sends /getall again.
        if (!(await sendPart(ctx, chatId, part))) return notice(ctx, en.admin.getall.sendFailed);
      }
      log.info(
        {
          adminTelegramId: ctx.user.telegramId.toString(),
          userId: user.id,
          walletCount: rows.length,
        },
        "admin.getall.reveal",
      );
    },

    /** ❌ Cancel (`adm:ga:no:<nonce>`): no key is read. */
    async cancel(ctx: BotContext, nonce: string): Promise<unknown> {
      if (ctx.session.getallReveal?.nonce === nonce) delete ctx.session.getallReveal;
      await dropKeyboard(ctx, ctx.callbackQuery?.message?.message_id);
      return notice(ctx, en.admin.getall.canceled);
    },
  };
}
