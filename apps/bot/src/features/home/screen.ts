import {
  a,
  cbBtn,
  code,
  en,
  encodeCallback,
  escapeHtml,
  formatSolPrice,
  formatSolWithUsd,
  formatTimeUtc,
  LAUNCH_COIN,
  planLabel,
  renderScreen,
  tree,
} from "@launchbot/shared";
import type { Screen, Ui } from "@launchbot/shared";
import type { Env } from "@launchbot/shared/server";
import { computeNextStep } from "./data.js";
import type { HomeData } from "./data.js";

/**
 * Callback data of the main menu (proposal). The ticket of each section handles exactly these
 * values when it replaces the provisional screen of its domain.
 */
export const MENU = {
  launchCoin: LAUNCH_COIN,
  simulate: encodeCallback("sim", "open"),
  subscribe: encodeCallback("sub", "open"),
  wallets: encodeCallback("wal", "list"),
  support: encodeCallback("sup", "open"),
  refresh: encodeCallback("home", "refresh"),
} as const;

export type HomeEnv = Pick<
  Env,
  "CHANNEL_BOT_URL" | "CHANNEL_SUCCESS_URL" | "CHANNEL_ANNOUNCEMENTS_URL"
>;

function subscriptionLine({ subscription, now }: HomeData): string {
  const label = planLabel(subscription, now);
  return label === null ? en.home.noSubscription : en.home.subscription(label);
}

function walletsLine({ wallets, solUsd }: HomeData): string {
  if (wallets.count === 0) return en.home.noWallet;
  const balance =
    wallets.totalLamports === null
      ? en.home.balanceUnavailable
      : formatSolWithUsd(wallets.totalLamports, solUsd);
  return en.home.wallets(wallets.count, balance);
}

/**
 * The home screen (§4.3). Pure: the same data gives the same screen, which is what lets a
 * Refresh answer "Already up to date". The mockup has no description: the ACCOUNT block and
 * the next step stand for it.
 */
export function buildHomeScreen(ui: Ui, env: HomeEnv, data: HomeData): Screen {
  const name = data.username !== null ? `@${data.username}` : (data.firstName ?? en.common.none);
  const account = tree(en.home.account, [
    escapeHtml(name),
    en.home.id(code(String(data.telegramId))),
    subscriptionLine(data),
    walletsLine(data),
  ]);
  const community = tree(en.home.community, [
    en.home.announcements(a(en.home.announcementsLabel, env.CHANNEL_ANNOUNCEMENTS_URL)),
    en.home.success(a(en.home.successLabel, env.CHANNEL_SUCCESS_URL)),
    en.home.botChannel(a(en.home.botChannelLabel, env.CHANNEL_BOT_URL), data.botChannelMembers),
    en.home.subscribers(data.activeSubscribers),
  ]);

  return renderScreen({
    header: ui.screenHeader(en.home.title),
    info: [account, community, en.home.solPrice(formatSolPrice(data.solUsd))].join("\n\n"),
    flags: [en.home.nextStep[computeNextStep(data)]],
    footer: en.common.updated(formatTimeUtc(data.updatedAt)),
    keyboard: [
      [cbBtn(en.menu.launchCoin, MENU.launchCoin)],
      [cbBtn(en.menu.simulate, MENU.simulate)],
      [cbBtn(en.menu.subscribe, MENU.subscribe)],
      [cbBtn(en.menu.wallets, MENU.wallets), cbBtn(en.menu.support, MENU.support)],
      [cbBtn(en.btn.refresh, MENU.refresh)],
    ],
  });
}
