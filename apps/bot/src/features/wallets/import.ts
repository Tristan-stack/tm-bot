import { en, IMPORT_INPUT_TIMEOUT_MS } from "@launchbot/shared";
import type { ImportFormat, OptionalLine } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import type { BotContext, PendingInput } from "../../context.js";
import type { SecretConsumer } from "../../middleware/sensitive-input.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { ShowMode } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import type { WalletNav } from "./nav.js";
import { buildImportInputScreen, buildImportScreen, importFormatOf } from "./screens.js";
import type { WalletQuotaView } from "./screens.js";

/** The import waiting for a message, as the session holds it. */
type PendingImport = Extract<PendingInput, { kind: "wallet_import" }>;
type ImportOptions = { flags?: OptionalLine[]; mode?: ShowMode };

/**
 * The counter of the import screen, or `null` when the user is at the limit: the list was shown
 * in its place with the flag (proposal: checked at the click, then again at every message). Two
 * cheap reads — the counter must not drag a balance read behind it.
 */
async function loadQuota(
  ctx: BotContext,
  nav: WalletNav,
  mode?: ShowMode,
): Promise<WalletQuotaView | null> {
  const { count, limit, reached } = await nav.wallets.getQuota(ctx.user.id);
  if (!reached) return { count, limit };
  await nav.blockOnList(ctx, en.wallets.limitReached, mode);
  return null;
}

/** IMPORT WALLET, with what went wrong on the previous attempt. */
async function showImport(
  ctx: BotContext,
  nav: WalletNav,
  options: ImportOptions = {},
): Promise<void> {
  const quota = await loadQuota(ctx, nav, options.mode);
  if (quota === null) return;
  const screen = buildImportScreen(nav.ui, quota, { flags: options.flags });
  await showScreen(ctx, screen, { mode: options.mode });
}

/**
 * Arms the input of one format: the next message is read as the secret, for two minutes. Every
 * failed format restarts that window (proposal), so the user can retype without clicking again.
 */
async function showInput(
  ctx: BotContext,
  nav: WalletNav,
  format: ImportFormat,
  options: ImportOptions = {},
): Promise<void> {
  const expiresAt = new Date(Date.now() + IMPORT_INPUT_TIMEOUT_MS);
  const screen = buildImportInputScreen(nav.ui, format, expiresAt, { flags: options.flags });
  await showScreen(ctx, screen, {
    mode: options.mode,
    input: { kind: "wallet_import", format, expiresAt: expiresAt.getTime() },
  });
}

/** `wal:imp` opens the choice, `wal:imp:key` and `wal:imp:seed` open an input (§9.4). */
export const importHandlers = (nav: WalletNav): Record<string, CallbackHandler> => ({
  async imp(ctx, [code]) {
    const format = importFormatOf(code);
    if (format === undefined) return showImport(ctx, nav);
    // The limit is read again: the screen may have been open for a while.
    if ((await loadQuota(ctx, nav)) !== null) await showInput(ctx, nav, format);
  },
});

/**
 * The message that answers an import input, in the order of §9.4. It was already deleted by
 * `sensitiveMessageGuard`, so every screen below edits the screen message in place (§4.4), and
 * the secret exists only as the argument of `importWallet`: never in the session, a log or a flag.
 */
export function importConsumer(nav: WalletNav): SecretConsumer<PendingImport> {
  return {
    waiting: (ctx) => {
      const pending = ctx.session.pendingInput;
      return pending?.kind === "wallet_import" ? pending : undefined;
    },

    async consume(ctx, { format, expiresAt }, { text, deleted }) {
      const mode = "edit";
      const notDeleted = deleted ? undefined : en.wallets.sensitive.notDeleted;
      const giveUp = (flag: string) => showImport(ctx, nav, { flags: [flag, notDeleted], mode });
      const retry = () =>
        showInput(ctx, nav, format, {
          flags: [en.wallets.import.invalid[format], notDeleted],
          mode,
        });

      // Expired lazily (D16): the secret was deleted all the same, and is not read.
      if (Date.now() > expiresAt) return giveUp(en.wallets.import.expired);
      if (!consumeRateLimit(Number(ctx.user.telegramId), "walletImport").ok) {
        return giveUp(en.wallets.import.tooManyAttempts);
      }
      // A sticker or a photo without a caption: nothing to parse, the input stays open.
      if (text === undefined) return retry();

      const result = await nav.wallets.importWallet(ctx.user.id, format, text);
      if (result.ok) {
        // Nothing of the key is shown, not even the source: the detail of §9.2 as it is.
        await nav.showDetail(ctx, result.wallet.id, { notice: en.wallets.import.done, mode });
        return;
      }
      switch (result.reason) {
        case "invalid_secret":
          return retry();
        case "duplicate":
          return giveUp(en.wallets.import.duplicate);
        case "limit_reached":
          // A Create in another chat took the last slot while this input was open.
          return nav.blockOnList(ctx, en.wallets.limitReached, mode);
      }
    },
  };
}
