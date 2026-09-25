import type { SupportDataService } from "@launchbot/db";
import { createLogger } from "@launchbot/shared/server";
import type { BotContext } from "../../context.js";
import { newNonce } from "../../navigation/confirm-token.js";
import type { DataServices } from "../../services/data.js";
import { oneUserArgs, renderAdminUserNotFound } from "./common.js";
import type { AdminKit } from "./common.js";
import {
  buildGetAllMessages,
  buildWhoisScreen,
  inactivitySweepLines,
  revealKeyboard,
} from "./user-data-screens.js";

const log = createLogger("bot:admin:user-data");

export type UserDataDeps = {
  kit: AdminKit;
  support: Pick<SupportDataService, "loadUserSupportData" | "inactivitySweeps">;
  /** The balances of the card (cached 30 s) and the SOL price. */
  data: Pick<DataServices, "getUserBalances" | "getSolUsdPrice">;
  now: () => Date;
};

/** `/whois` and `/getall` (§11.4, V1-43): new messages in answer to the command, no key. */
export function createUserData(deps: UserDataDeps): {
  whois: (ctx: BotContext) => Promise<unknown>;
  getall: (ctx: BotContext) => Promise<unknown>;
} {
  const { kit, support, data, now } = deps;
  const { ui } = kit;
  const logged = (ctx: BotContext, userId: string) => ({
    adminTelegramId: ctx.user.telegramId.toString(),
    userId,
  });

  return {
    async whois(ctx: BotContext): Promise<unknown> {
      const args = await kit.parseArgs(ctx, "whois", oneUserArgs);
      if (args === null) return;
      const [{ query, ref }] = args;
      const user = await kit.resolveUserRef(ref);
      if (user === null) return kit.replyNotFound(ctx, "whois", query);
      const at = now();
      const loaded = await support.loadUserSupportData(user, at);
      log.info(logged(ctx, user.id), "admin.whois");
      return kit.reply(ctx, buildWhoisScreen(ui, { data: loaded, ref, now: at }));
    },

    async getall(ctx: BotContext): Promise<unknown> {
      const args = await kit.parseArgs(ctx, "getall", oneUserArgs);
      if (args === null) return;
      const [{ query, ref }] = args;
      // Each /getall replaces the request of the one before: its Reveal keys is dead.
      delete ctx.session.getallReveal;
      const user = await kit.resolveUserRef(ref);
      if (user === null) {
        // An account deleted for inactivity: its transfers to the treasury, for a refund.
        const lines = inactivitySweepLines(ui, await support.inactivitySweeps(ref.telegramId));
        return kit.reply(ctx, renderAdminUserNotFound(ui, "getall", query, { lines }));
      }

      const at = now();
      const [loaded, balances, solUsd] = await Promise.all([
        support.loadUserSupportData(user, at),
        data.getUserBalances(user.id),
        data.getSolUsdPrice(),
      ]);
      log.info(logged(ctx, user.id), "admin.getall");
      const parts = buildGetAllMessages(ui, { data: loaded, balances, solUsd, now: at });
      // No wallet, no key: the card needs no confirmation.
      if (loaded.wallets.length === 0) return kit.replyParts(ctx, parts);

      const nonce = newNonce(16);
      ctx.session.getallReveal = {
        nonce,
        targetUserId: user.id,
        targetTelegramId: user.telegramId.toString(),
        createdAt: at.getTime(),
      };
      return kit.replyParts(ctx, parts, revealKeyboard(nonce));
    },
  };
}
