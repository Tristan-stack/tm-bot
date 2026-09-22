import type { RenameIssue, WalletSummary } from "@launchbot/db";
import { en, escapeHtml, WALLET_NAME_MAX_CHARS } from "@launchbot/shared";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../../context.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { ShowMode } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import type { WalletNav } from "./nav.js";
import { buildRenameScreen } from "./screens.js";

/** The flag of the input screen for what was wrong (§4.5). */
function flagOf(issue: RenameIssue): string {
  const { errors } = en.wallets.rename;
  switch (issue.reason) {
    case "empty":
      return errors.empty;
    case "too_long":
      return errors.tooLong(issue.length, WALLET_NAME_MAX_CHARS);
    case "invalid":
      return errors.oneLine;
    case "duplicate":
      return errors.duplicate(escapeHtml(issue.name));
  }
}

/** The input screen, armed: the next text message of the user renames this wallet. */
const showRename = (
  ctx: BotContext,
  nav: WalletNav,
  wallet: WalletSummary,
  options: { flag?: string; mode?: ShowMode } = {},
) =>
  showScreen(ctx, buildRenameScreen(nav.ui, wallet, { flag: options.flag }), {
    mode: options.mode,
    input: { kind: "wallet_rename", walletId: wallet.id },
  });

/** `wal:ren:<id>`: opens the input (D16: the session remembers it, a restart keeps it). */
export const renameHandlers = (nav: WalletNav): Record<string, CallbackHandler> => ({
  async ren(ctx, [id]) {
    const view = await nav.loadDetail(ctx, id);
    if (view !== null) await showRename(ctx, nav, view.wallet);
  },
});

/**
 * The message that answers "Send the new name.". The message of the user is deleted (best
 * effort, proposal) and the screen is edited in place: the chat keeps one screen.
 */
export function handleRenameInput(nav: WalletNav): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const pending = ctx.session.pendingInput;
    if (pending?.kind !== "wallet_rename" || ctx.message === undefined) return next();

    // Not waited for: the rename does not depend on it.
    const deleting = ctx.deleteMessage().catch(() => undefined);
    const text = ctx.message.text;
    const result =
      text === undefined ? null : await nav.wallets.rename(ctx.user.id, pending.walletId, text);
    await deleting;

    if (result === null) {
      // A photo, a sticker: the input stays open, with the wallet read again for its name.
      const detail = await nav.wallets.getOwned(ctx.user.id, pending.walletId);
      if (detail === null) return nav.showNotFound(ctx, "edit");
      await showRename(ctx, nav, detail.wallet, {
        flag: en.wallets.rename.errors.notText,
        mode: "edit",
      });
      return;
    }
    if (result.ok) {
      await nav.showDetail(ctx, result.wallet.id, { notice: en.wallets.rename.done, mode: "edit" });
      return;
    }
    if (!("wallet" in result)) return nav.showNotFound(ctx, "edit");
    await showRename(ctx, nav, result.wallet, { flag: flagOf(result.issue), mode: "edit" });
  };
}
