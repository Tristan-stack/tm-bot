import type { Ui } from "@launchbot/shared";
import type { Composer } from "grammy";
import type { BotContext } from "../../context.js";
import { mayReadFreshBalances } from "../../middleware/rate-limit.js";
import { notifyIfUnchanged, showScreen } from "../../navigation/show-screen.js";
import type { ShowMode, ShowResult } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import type { Access } from "../access/access.js";
import { loadHomeData } from "./data.js";
import type { HomeSources } from "./data.js";
import { buildHomeScreen } from "./screen.js";
import type { HomeEnv } from "./screen.js";

export type HomeDeps = {
  ui: Ui;
  env: HomeEnv;
  data: HomeSources;
  /** `LAUNCH_TEST_DIVISOR` (decision of 26/09/2026): « Fund a wallet » counts test amounts. */
  launchDivisor: bigint;
};

/** /start, `nav:home` (the one target of every Back and Menu), Refresh and the `home` resume. */
export function registerHome(
  bot: Composer<BotContext>,
  router: CallbackRouter,
  access: Access,
  { ui, env, data, launchDivisor }: HomeDeps,
): void {
  async function showHome(
    ctx: BotContext,
    options: { display?: ShowMode; skipBalanceCache?: boolean } = {},
  ): Promise<ShowResult> {
    const { display, skipBalanceCache = false } = options;
    const home = await loadHomeData(data, ctx.user, { skipBalanceCache, launchDivisor });
    return showScreen(ctx, buildHomeScreen(ui, env, home), { mode: display });
  }

  // §4.2: the membership is checked again on every /start, with a cache of 10 minutes.
  // §4.3: /start always sends a new message.
  bot.command("start", async (ctx) => {
    const isMember = await access.ensureChannelMembership(ctx, {
      mode: "cached",
      resume: "home",
      display: "new",
    });
    if (isMember) await showHome(ctx, { display: "new" });
  });

  // After "I've joined": the home screen replaces the channel screen, in the same message.
  access.registerResume("home", showHome);

  router.register("nav", { home: (ctx) => showHome(ctx) });

  router.register("home", {
    refresh: async (ctx) =>
      notifyIfUnchanged(ctx, await showHome(ctx, { skipBalanceCache: mayReadFreshBalances(ctx) })),
  });
}
