import type { AccountDeletionService, DeleteUserResult } from "@launchbot/db";
import { en, parseTelegramId } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { BotContext } from "../../context.js";
import { notify } from "../../navigation/notify.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import type { DataServices } from "../../services/data.js";
import {
  MENU_ROW,
  oneUserArgs,
  renderAdminNotice,
  renderAdminUserNotFound,
  tellUser,
} from "./common.js";
import type { AdminKit } from "./common.js";
import { buildPurgeResultScreen, buildPurgeSummaryScreen } from "./purge-screens.js";

const log = createLogger("bot:admin:purge");

export type PurgeDeps = {
  kit: AdminKit;
  deletion: Pick<AccountDeletionService, "getPurgeSummary" | "deleteUserData">;
  data: Pick<DataServices, "invalidateUserBalances">;
  now: () => Date;
};

/**
 * `/purge <code or id>` and `adm:prg:ok:<telegramId>` / `adm:prg:no` (§11.3, §11.4, V1-44).
 * Nothing in the session: the summary and its blockers are read again at the click.
 */
export function createPurge(deps: PurgeDeps): {
  command: (ctx: BotContext) => Promise<unknown>;
  callback: CallbackHandler;
} {
  const { kit, deletion, data, now } = deps;
  const { ui } = kit;
  const notice = (ctx: BotContext, text: string) =>
    showScreen(ctx, renderAdminNotice(ui, "purge", text, [MENU_ROW]));
  const notFound = (ctx: BotContext, telegramId: bigint) =>
    showScreen(
      ctx,
      renderAdminUserNotFound(ui, "purge", telegramId.toString(), { keyboard: [MENU_ROW] }),
    );

  async function confirm(ctx: BotContext, arg: string | undefined): Promise<unknown> {
    // A Telegram id, as the codec wrote it.
    const telegramId = arg === undefined ? null : parseTelegramId(arg);
    if (telegramId === null) return notify(ctx, en.common.staleButton);
    // Everything again, without cache: another admin, a deposit, an invoice since the summary.
    const summary = await deletion.getPurgeSummary(telegramId);
    if (summary === null) return notFound(ctx, telegramId);
    if (summary.blockers.length > 0) {
      await notify(ctx, en.admin.purge.changed, { alert: true });
      return showScreen(ctx, buildPurgeSummaryScreen(ui, { summary, now: now() }));
    }

    const { user } = summary;
    // « Your data has been deleted. », right before the deletion (§11.3): refused, it goes on.
    const notified = await tellUser(ctx, user, en.admin.purge.userNotice, "purge.not_notified");
    let deleted: DeleteUserResult;
    try {
      deleted = await deletion.deleteUserData(user.id);
    } catch (error) {
      log.error({ userId: user.id, err: error }, "purge.failed");
      return notice(ctx, en.admin.purge.failed);
    }
    if (deleted.status !== "DELETED") return notFound(ctx, telegramId);
    data.invalidateUserBalances(user.id);
    log.info(
      { adminTelegramId: ctx.user.telegramId.toString(), userId: user.id, ...deleted.counts },
      "purge.done",
    );
    return showScreen(ctx, buildPurgeResultScreen(ui, { counts: deleted.counts, notified }));
  }

  return {
    async command(ctx) {
      const args = await kit.parseArgs(ctx, "purge", oneUserArgs);
      if (args === null) return;
      // The id only: the letter of a code may be older than the plan (V1-40).
      const [{ query, ref }] = args;
      const summary = await deletion.getPurgeSummary(ref.telegramId);
      if (summary === null) return kit.replyNotFound(ctx, "purge", query);
      return kit.reply(ctx, buildPurgeSummaryScreen(ui, { summary, now: now() }));
    },

    callback(ctx, [action, arg]) {
      if (action === "ok") return confirm(ctx, arg);
      if (action !== "no") return notify(ctx, en.common.staleButton);
      return notice(ctx, en.admin.purge.canceled);
    },
  };
}
