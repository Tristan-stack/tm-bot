import type { WalletDetailData, WalletService } from "@launchbot/db";
import { en } from "@launchbot/shared";
import type { Screen, Ui } from "@launchbot/shared";
import type { BotContext } from "../../context.js";
import { blockWithFlag, showScreen } from "../../navigation/show-screen.js";
import type { Block, ShowMode, ShowResult } from "../../navigation/show-screen.js";
import type { DataServices } from "../../services/data.js";
import {
  buildWalletDetailScreen,
  buildWalletListScreen,
  buildWithdrawSoonScreen,
} from "./screens.js";
import type { WalletDetailView } from "./screens.js";

export type WalletsDeps = {
  ui: Ui;
  wallets: WalletService;
  data: Pick<DataServices, "getSolUsdPrice">;
};

type RenderOptions = { notice?: string; flag?: string };
type ShowOptions = { skipCache?: boolean; mode?: ShowMode };

/** The screens every handler of the section reaches: list, detail, and the two fallbacks. */
export function createWalletNav({ ui, wallets, data }: WalletsDeps) {
  /** The list as a render, so a blocked click can add its flag to it (§4.5). */
  async function listRender(
    ctx: BotContext,
    skipCache = false,
  ): Promise<(options?: RenderOptions) => Screen> {
    const [list, solUsd] = await Promise.all([
      wallets.listWithBalances(ctx.user.id, { skipCache }),
      // Never forced: the price stays cached 60 s for everyone (§4.4).
      data.getSolUsdPrice(),
    ]);
    return (options) => buildWalletListScreen(ui, { ...list, solUsd }, options);
  }

  async function showList(
    ctx: BotContext,
    options: ShowOptions & RenderOptions = {},
  ): Promise<ShowResult> {
    const { skipCache, mode, ...render } = options;
    return showScreen(ctx, (await listRender(ctx, skipCache))(render), { mode });
  }

  /** A blocked click answered on the list: alert, then the list with the flag (§4.5). */
  async function blockOnList(ctx: BotContext, block: Block, mode?: ShowMode): Promise<void> {
    const render = await listRender(ctx);
    await blockWithFlag(ctx, block, (flag) => render({ flag }), { mode });
  }

  /** An id that is not a wallet of the user: the list says so. */
  const showNotFound = (ctx: BotContext, mode?: ShowMode) =>
    blockOnList(ctx, en.wallets.notFound, mode);

  /** `null` when the wallet is gone: the list was shown in its place. */
  async function loadDetail(
    ctx: BotContext,
    walletId: string | undefined,
    options: ShowOptions = {},
  ): Promise<WalletDetailView | null> {
    const [detail, solUsd] = await Promise.all([
      wallets.getOwned(ctx.user.id, walletId ?? "", { skipCache: options.skipCache }),
      data.getSolUsdPrice(),
    ]);
    if (detail !== null) return { ...detail, solUsd };
    await showNotFound(ctx, options.mode);
    return null;
  }

  async function showDetail(
    ctx: BotContext,
    walletId: string | undefined,
    options: ShowOptions & RenderOptions = {},
  ): Promise<ShowResult | null> {
    const { skipCache, mode, ...render } = options;
    const view = await loadDetail(ctx, walletId, { skipCache, mode });
    if (view === null) return null;
    return showScreen(ctx, buildWalletDetailScreen(ui, view, render), { mode });
  }

  /** A blocked click on a detail the caller already holds: alert, then that detail flagged. */
  async function blockOnDetail(
    ctx: BotContext,
    detail: WalletDetailData,
    block: Block,
  ): Promise<void> {
    const solUsd = await data.getSolUsdPrice();
    const view = { ...detail, solUsd };
    await blockWithFlag(ctx, block, (flag) => buildWalletDetailScreen(ui, view, { flag }));
  }

  async function showWithdrawSoon(ctx: BotContext, walletId: string | undefined): Promise<void> {
    const view = await loadDetail(ctx, walletId);
    if (view !== null) await showScreen(ctx, buildWithdrawSoonScreen(ui, view));
  }

  return {
    ui,
    wallets,
    data,
    listRender,
    showList,
    blockOnList,
    showNotFound,
    loadDetail,
    showDetail,
    blockOnDetail,
    showWithdrawSoon,
  };
}

export type WalletNav = ReturnType<typeof createWalletNav>;
