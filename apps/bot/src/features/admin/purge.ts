import type {
  AccountDeletionService,
  AccountSweep,
  AccountSweeper,
  DeleteUserResult,
} from "@launchbot/db";
import { en, parseTelegramId } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { BotContext } from "../../context.js";
import { acknowledge, notify } from "../../navigation/notify.js";
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
import {
  buildPurgeResultScreen,
  buildPurgeStoppedScreen,
  buildPurgeSummaryScreen,
} from "./purge-screens.js";

const log = createLogger("bot:admin:purge");

export type PurgeDeps = {
  kit: AdminKit;
  deletion: Pick<AccountDeletionService, "getPurgeSummary" | "deleteUserData">;
  /** The SOL of the wallets to the treasury first (decision of 25/09/2026, PURGE_SWEEP). */
  sweeper: Pick<AccountSweeper, "sweepAccount">;
  data: Pick<DataServices, "invalidateUserBalances">;
  now: () => Date;
};

/**
 * `/purge <code or id>` and `adm:prg:ok:<telegramId>` / `adm:prg:no` (§11.3, §11.4, V1-44).
 * Nothing in the session: the summary and its blockers are read again at the click. The SOL of
 * the wallets goes to the treasury before the deletion (decision of 25/09/2026).
 */
export function createPurge(deps: PurgeDeps): {
  command: (ctx: BotContext) => Promise<unknown>;
  callback: CallbackHandler;
} {
  const { kit, deletion, sweeper, data, now } = deps;
  const { ui } = kit;
  const notice = (ctx: BotContext, text: string) =>
    showScreen(ctx, renderAdminNotice(ui, "purge", text, [MENU_ROW]));
  const notFound = (ctx: BotContext, telegramId: bigint) =>
    showScreen(
      ctx,
      renderAdminUserNotFound(ui, "purge", telegramId.toString(), { keyboard: [MENU_ROW] }),
    );
  /** The transfers or the deletion threw: nothing was deleted, the admin can try again. */
  const failed = (ctx: BotContext, userId: string, error: unknown) => {
    log.error({ userId, err: error }, "purge.failed");
    return notice(ctx, en.admin.purge.failed);
  };

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
    // The transfers take a few seconds each: the click is answered now, no alert comes after.
    await acknowledge(ctx);
    if (summary.toTreasuryLamports > 0n) {
      await showScreen(ctx, renderAdminNotice(ui, "purge", en.admin.purge.moving));
    }
    let swept: AccountSweep;
    try {
      swept = await sweeper.sweepAccount(user, { kind: "PURGE_SWEEP" });
    } catch (error) {
      return failed(ctx, user.id, error);
    }
    if (swept.status === "KEPT") {
      // Every key is kept: a new /purge moves what is left, never twice the same SOL.
      log.warn(
        { userId: user.id, reason: swept.reason, transfers: swept.transfers.length },
        "purge.stopped",
      );
      return showScreen(ctx, buildPurgeStoppedScreen(ui, swept.transfers));
    }

    // « Your data has been deleted. », right before the deletion (§11.3): refused, it goes on.
    const notified = await tellUser(ctx, user, en.admin.purge.userNotice, "purge.not_notified");
    let deleted: DeleteUserResult;
    try {
      deleted = await deletion.deleteUserData(user.id);
    } catch (error) {
      return failed(ctx, user.id, error);
    }
    if (deleted.status !== "DELETED") return notFound(ctx, telegramId);
    data.invalidateUserBalances(user.id);
    log.info(
      {
        adminTelegramId: ctx.user.telegramId.toString(),
        userId: user.id,
        ...deleted.counts,
        sweeps: swept.transfers.length,
      },
      "purge.done",
    );
    return showScreen(
      ctx,
      buildPurgeResultScreen(ui, {
        counts: deleted.counts,
        notified,
        transfers: swept.transfers,
      }),
    );
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
