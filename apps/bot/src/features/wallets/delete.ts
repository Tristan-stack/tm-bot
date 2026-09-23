import type { DeleteCheck } from "@launchbot/db";
import { en } from "@launchbot/shared";
import type { BotContext } from "../../context.js";
import { notify } from "../../navigation/notify.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import type { WalletNav } from "./nav.js";
import { buildDeleteBlockedScreen, buildDeleteConfirmScreen } from "./screens.js";

/** `wal:del:<id>` and `wal:delok:<id>` (§9.3); `wal:wdall:<id>` belongs to the withdrawal. */
export function deleteHandlers(nav: WalletNav): Record<string, CallbackHandler> {
  /** The screen of what the check found: confirmation, blocking, or a flag on the detail. */
  async function showCheck(ctx: BotContext, check: DeleteCheck): Promise<void> {
    switch (check.status) {
      case "confirm":
        await showScreen(ctx, buildDeleteConfirmScreen(nav.ui, check.detail.wallet));
        return;
      case "blocked_balance": {
        const solUsd = await nav.data.getSolUsdPrice();
        const screen = buildDeleteBlockedScreen(
          nav.ui,
          check.detail.wallet,
          check.lamports,
          solUsd,
        );
        await showScreen(ctx, screen);
        return;
      }
      case "balance_unavailable":
        // Nothing is deleted on a balance nobody could read.
        return nav.blockOnDetail(ctx, check.detail, en.wallets.delete.checkFailed);
      case "blocked_pending_withdrawal":
        return nav.blockOnDetail(ctx, check.detail, en.wallets.delete.pendingWithdrawal);
      case "not_found":
        return nav.showNotFound(ctx);
    }
  }

  return {
    del: async (ctx, [id]) =>
      showCheck(ctx, await nav.wallets.checkDeletable(ctx.user.id, id ?? "")),

    async delok(ctx, [id]) {
      const result = await nav.wallets.delete(ctx.user.id, id ?? "");
      if (result.status === "deleted") {
        await nav.showList(ctx, { notice: en.wallets.delete.done });
        return;
      }
      // SOL arrived since the confirmation screen: the blocking screen says why (§4.5).
      if (result.status === "blocked_balance") {
        await notify(ctx, en.wallets.delete.receivedSol, { alert: true });
      }
      await showCheck(ctx, result);
    },
  };
}
