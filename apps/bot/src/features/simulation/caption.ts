import {
  cbBtn,
  en,
  formatClock,
  formatInt,
  formatPct,
  formatSol,
  formatUsd,
  NAV_HOME,
  progressBar,
  SIM_SPEEDS,
  solToLamports,
} from "@launchbot/shared";
import type { SimSpeed, Ui } from "@launchbot/shared";
import type { PnlCardModel, PositionView, SimToken } from "@launchbot/sim-render";
import type { InlineKeyboardMarkup } from "grammy/types";
import { SELL_PCTS, SIM_CB, tokenLine } from "./screens.js";

const PROGRESS_SEGMENTS = 10;

/** `$5,175.82 (50.08 SOL)` with the frozen price, `50.08 SOL` without. */
export function formatMarketCap(marketCapSol: number, solUsdPrice: number | null): string {
  const sol = formatSol(solToLamports(marketCapSol), { decimals: 2 });
  return solUsdPrice === null ? sol : `${formatUsd(marketCapSol * solUsdPrice)} (${sol})`;
}

export type LiveView = {
  token: SimToken;
  clock: { nowSec: number; durationSec: number };
  speed: SimSpeed;
  paused: boolean;
  solUsdPrice: number | null;
  stats: {
    marketCapSol: number;
    /** Share of the real reserves sold, in [0, 1] (§7.1). */
    progress: number;
    volumeSol: number;
    buys: number;
    sells: number;
  };
  position: PositionView;
};

/** The caption of the running simulation (§6.1): header, mention, token, clock, stats, position. */
export function buildLiveCaption(ui: Ui, view: LiveView): string {
  const { live } = en.sim;
  const { stats, position } = view;
  return [
    ui.screenHeader(en.flows.SIMULATION.title),
    en.sim.demoBanner,
    "",
    tokenLine(view.token.name, view.token.ticker),
    `${live.clock(formatClock(view.clock.nowSec), formatClock(view.clock.durationSec))} · ${
      view.paused ? live.paused : live.speed(view.speed)
    }`,
    "",
    live.marketCap(formatMarketCap(stats.marketCapSol, view.solUsdPrice)),
    live.bondingCurve(
      formatPct(stats.progress, 1),
      progressBar(stats.progress * PROGRESS_SEGMENTS, PROGRESS_SEGMENTS),
    ),
    live.volume(
      formatSol(solToLamports(stats.volumeSol)),
      formatInt(stats.buys),
      formatInt(stats.sells),
    ),
    "",
    live.hold(position.holdText),
    live.value(position.valueText),
    live.pnl(position.pnlText),
    ...(position.soldText === null ? [] : [live.soldSoFar(position.soldText)]),
  ].join("\n");
}

/** `[ Sell 25% ][ Sell 50% ][ Sell 100% ]` then `[ ⏸ Pause ][ x1 ][ ✓ x2 ][ x5 ]`. */
export function buildLiveKeyboard(
  simId: string,
  state: { speed: SimSpeed; paused: boolean },
): InlineKeyboardMarkup {
  const { live } = en.sim;
  return {
    inline_keyboard: [
      SELL_PCTS.map((pct) => cbBtn(live.btnSell(pct), SIM_CB.sell(simId, pct))),
      [
        state.paused
          ? cbBtn(live.btnResume, SIM_CB.resume(simId))
          : cbBtn(live.btnPause, SIM_CB.pause(simId)),
        ...SIM_SPEEDS.map((speed) =>
          cbBtn(live.btnSpeed(speed, speed === state.speed), SIM_CB.speed(simId, speed)),
        ),
      ],
    ],
  };
}

/** `3.000 SOL ($310)`, or `3.000 SOL` without a price. */
const solWithUsd = (sol: string, usd: string | undefined): string =>
  usd === undefined ? `${sol} SOL` : `${sol} SOL (${usd})`;

/** The caption of the PNL card (§6.3): ticker and PnL, then Invested / Sell / Profit. */
export function buildEndedCaption(ui: Ui, card: PnlCardModel): string {
  const { card: texts } = en.sim;
  return [
    ui.screenHeader(texts.title),
    en.sim.demoBanner,
    "",
    texts.headline(card.tickerText, card.pnlPctText),
    texts.invested(solWithUsd(card.investedText, card.usd?.invested)),
    texts.sell(solWithUsd(card.positionSolText, card.usd?.position)),
    texts.profit(solWithUsd(card.pnlSolBig, card.usd?.pnl)),
  ].join("\n");
}

/** `[ 🔁 Run again ][ 🏠 Menu ]` */
export const buildEndedKeyboard = (simId: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [cbBtn(en.sim.live.btnRunAgain, SIM_CB.again(simId)), cbBtn(en.btn.menu, NAV_HOME)],
  ],
});
