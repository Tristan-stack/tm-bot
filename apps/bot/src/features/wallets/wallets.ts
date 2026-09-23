import { en } from "@launchbot/shared";
import { mayReadFreshBalances } from "../../middleware/rate-limit.js";
import type { InputRouter } from "../../navigation/inputs.js";
import { notifyIfUnchanged } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import { deleteHandlers } from "./delete.js";
import { importHandlers } from "./import.js";
import type { WalletNav } from "./nav.js";
import { renameHandlers, renameInput } from "./rename.js";
import { createWithdraw } from "./withdraw.js";

/**
 * The Wallets section (§9.1 to §9.5): list, detail, Create, Import, Rename, Delete and the
 * withdrawal. The import input is consumed earlier in the chain, by `sensitiveMessageGuard`:
 * `createBot` builds the navigation for both. The other inputs answer through `inputs`.
 */
export function registerWallets(router: CallbackRouter, inputs: InputRouter, nav: WalletNav): void {
  const { wallets } = nav;
  const withdraw = createWithdraw(nav);

  inputs.register("wallet_rename", renameInput(nav));
  inputs.register("withdraw_address", withdraw.inputs.address);
  inputs.register("withdraw_amount", withdraw.inputs.amount);

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

    // Also Cancel and Back to wallet of a withdrawal (§9.5): showing it ends the flow.
    v: (ctx, [id]) => nav.showDetail(ctx, id),
    ref: async (ctx, [id]) =>
      notifyIfUnchanged(
        ctx,
        await nav.showDetail(ctx, id, { skipCache: mayReadFreshBalances(ctx) }),
      ),

    ...withdraw.handlers,
    ...importHandlers(nav),
    ...renameHandlers(nav),
    ...deleteHandlers(nav),
  });
}
