import { en } from "@launchbot/shared";
import type { Composer } from "grammy";
import type { BotContext } from "../../context.js";
import { mayReadFreshBalances } from "../../middleware/rate-limit.js";
import { notifyIfUnchanged, showScreen } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import { deleteHandlers } from "./delete.js";
import { createWalletNav } from "./nav.js";
import type { WalletsDeps } from "./nav.js";
import { handleRenameInput, renameHandlers } from "./rename.js";
import { buildImportSoonScreen } from "./screens.js";

export type { WalletsDeps } from "./nav.js";

/** The Wallets section (§9.1 to §9.3): list, detail, Create, Rename, Delete, provisional Import and Withdraw. */
export function registerWallets(
  bot: Composer<BotContext>,
  router: CallbackRouter,
  deps: WalletsDeps,
): void {
  const nav = createWalletNav(deps);
  const { wallets } = deps;

  // The text that answers "Send the new name." (V1-11).
  bot.on("message", handleRenameInput(nav));

  router.register("wal", {
    list: (ctx) => nav.showList(ctx),
    lref: async (ctx) =>
      notifyIfUnchanged(ctx, await nav.showList(ctx, { skipCache: mayReadFreshBalances(ctx) })),

    async new(ctx) {
      const result = await wallets.create(ctx.user.id);
      // §4.5: the alert never replaces the text, the list gets the flag too.
      if (!result.ok) return nav.blockOnList(ctx, en.wallets.limitReached);
      // Nothing else is shown: no key, no seed phrase (decision of 16/09/2026).
      await nav.showDetail(ctx, result.wallet.id, { notice: en.wallets.created });
    },

    imp: (ctx) => showScreen(ctx, buildImportSoonScreen(nav.ui)),
    v: (ctx, [id]) => nav.showDetail(ctx, id),
    ref: async (ctx, [id]) =>
      notifyIfUnchanged(
        ctx,
        await nav.showDetail(ctx, id, { skipCache: mayReadFreshBalances(ctx) }),
      ),
    wd: (ctx, [id]) => nav.showWithdrawSoon(ctx, id),

    ...renameHandlers(nav),
    ...deleteHandlers(nav),
  });
}
