import { cbBtn, code, en, encodeCallback, formatTimeUtc, renderScreen } from "@launchbot/shared";
import type { Screen, Ui } from "@launchbot/shared";
import type { Composer } from "grammy";
import type { BotContext } from "../context.js";
import { notify } from "../navigation/notify.js";
import { showScreen } from "../navigation/show-screen.js";
import type { CallbackRouter } from "../router/callback-router.js";

/** Same callback data as the future Refresh of the home screen (V1-08). */
const REFRESH = encodeCallback("home", "refresh");

/**
 * Provisional screen, replaced by V1-06 then V1-08. It proves the whole skeleton: header with
 * the cluster badge, single-message navigation and a Refresh that reports "Already up to date".
 */
const renderStartScreen = (ui: Ui, ctx: BotContext): Screen =>
  renderScreen({
    header: ui.screenHeader(en.start.title),
    description: en.start.description,
    info: en.start.id(code(String(ctx.user.telegramId))),
    footer: en.common.updated(formatTimeUtc(new Date())),
    keyboard: [[cbBtn(en.btn.refresh, REFRESH)]],
  });

export function registerStart(bot: Composer<BotContext>, router: CallbackRouter, ui: Ui): void {
  // §4.3: /start always sends a new message.
  bot.command("start", async (ctx) => {
    await showScreen(ctx, renderStartScreen(ui, ctx), { mode: "new" });
  });

  router.register("home", async (ctx, { action }) => {
    if (action !== "refresh") return notify(ctx, en.common.staleButton);
    const { status } = await showScreen(ctx, renderStartScreen(ui, ctx));
    // The footer only shows minutes: two refreshes in the same minute are the same screen.
    if (status === "not_modified") await notify(ctx, en.common.alreadyUpToDate);
  });
}
