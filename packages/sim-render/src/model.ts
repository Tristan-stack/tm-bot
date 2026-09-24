import {
  formatPctSupply,
  formatSol,
  formatSolAmount,
  formatTicker,
  formatTokenAmount,
  formatUsd,
  solToLamports,
  usdOf,
  withUsd,
} from "@launchbot/shared";
import type { Position, SimConfig } from "@launchbot/sim-engine";

/** What the pictures and the captions show of the token: its name and its ticker without `$`. */
export type SimToken = { name: string; ticker: string };

export type ChartUnit = "USD" | "SOL";
export type Tone = "positive" | "negative" | "neutral";

/** The unit of the value axis: USD with the SOL price frozen at creation (§4.3), else SOL. */
export const chartUnit = (config: Pick<SimConfig, "solUsdPrice">): ChartUnit =>
  config.solUsdPrice === null ? "SOL" : "USD";

/** Price → market cap on the axis: × total supply, × the SOL price when there is one (§7.1). */
export const axisScale = (config: Pick<SimConfig, "curve" | "solUsdPrice">): number =>
  config.curve.totalSupply * (config.solUsdPrice ?? 1);

const toneOf = (value: number): Tone =>
  value > 0 ? "positive" : value < 0 ? "negative" : "neutral";

/** `+1.280 SOL`, `-0.540 SOL`, `0.000 SOL`: the sign follows the rounded amount. */
export const formatSignedSol = (sol: number): string =>
  formatSol(solToLamports(sol), { decimals: 3, signed: true });

/** `+42.7%`, `-12.4%`, `0.0%`: `pct` is already a percentage (`Position.pnlPct`). */
export function formatSignedPct(pct: number): string {
  const text = Math.abs(pct).toFixed(1);
  if (Number(text) === 0) return `${text}%`;
  return `${pct < 0 ? "-" : "+"}${text}%`;
}

export type PositionView = {
  /** `96.66M OTTR (9.67%)`: the tokens held and their share of the supply. */
  holdText: string;
  /** `≈ 3.412 SOL ($352.66)`: `valueIfSoldNow` of the engine (§6.2), USD by the frozen price. */
  valueText: string;
  /** `+0.412 SOL (+13.7%)` */
  pnlText: string;
  /** `1.234 SOL` once the dev sold something, null before. */
  soldText: string | null;
};

/** The position block of the caption (§6.1, §6.2): values only, the labels are the caller's. */
export function buildPositionView(
  position: Position,
  config: Pick<SimConfig, "curve" | "solUsdPrice">,
  ticker: string,
): PositionView {
  const value = solToLamports(position.valueIfSoldNow);
  return {
    holdText: `${formatTokenAmount(position.tokens)} ${ticker} (${formatPctSupply(
      (position.tokens / config.curve.totalSupply) * 100,
    )})`,
    valueText: `≈ ${withUsd(formatSol(value), usdOf(value, config.solUsdPrice))}`,
    pnlText: `${formatSignedSol(position.pnlSol)} (${formatSignedPct(position.pnlPct)})`,
    soldText: position.solOut > 0 ? formatSol(solToLamports(position.solOut)) : null,
  };
}

export type PnlCardModel = {
  /** `$OTTR`, the ticker as the mock-up shows it. */
  tickerText: string;
  /** The ticker without `$`, for the badge when there is no logo. */
  ticker: string;
  /** `+2.630`, `-0.540`: the PnL in SOL, the figure of the pill. */
  pnlSolBig: string;
  /** `+42.7%` */
  pnlPctText: string;
  /** `2.433`: the dev buy, "Invested" on the card. */
  investedText: string;
  /** `5.063`: sold + the rest valued as sold at the end, "Position" on the card, "Sell" in the caption. */
  positionSolText: string;
  /** `$287`, `$598`, `$311` (`-$56` on a loss): whole dollars for the caption, null without a price. */
  usd: { invested: string; position: string; pnl: string } | null;
  tone: Tone;
};

export type PnlCardInput = {
  position: Position;
  config: Pick<SimConfig, "solUsdPrice">;
  token: SimToken;
};

const MILLIS_PER_SOL = 1000;
const LAMPORTS_PER_MILLI = 1_000_000n;
const millis = (sol: number): number => Math.round(sol * MILLIS_PER_SOL);
const solOfMillis = (value: number, signed = false): string =>
  formatSolAmount(BigInt(value) * LAMPORTS_PER_MILLI, { decimals: 3, signed });

/**
 * The PNL card (§6.3). Invested and Position are rounded to 3 decimals first and the PnL is
 * their difference, so that the card adds up on screen.
 */
export function buildPnlCardModel(input: PnlCardInput): PnlCardModel {
  const { position, config, token } = input;
  const invested = millis(position.solIn);
  const positionSol = millis(position.solOut + position.valueIfSoldNow);
  const pnl = positionSol - invested;
  const usd = (value: number): string =>
    formatUsd((value / MILLIS_PER_SOL) * (config.solUsdPrice ?? 0), { decimals: 0 });

  return {
    tickerText: formatTicker(token.ticker),
    ticker: token.ticker,
    pnlSolBig: solOfMillis(pnl, true),
    pnlPctText: formatSignedPct(position.pnlPct),
    investedText: solOfMillis(invested),
    positionSolText: solOfMillis(positionSol),
    usd:
      config.solUsdPrice === null
        ? null
        : { invested: usd(invested), position: usd(positionSol), pnl: usd(pnl) },
    tone: toneOf(pnl),
  };
}
