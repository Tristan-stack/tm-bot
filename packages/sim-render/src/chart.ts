import { en, formatClock, formatInt, formatTicker, formatUsd } from "@launchbot/shared";
import { CANDLE_INTERVAL_SEC } from "@launchbot/sim-engine";
import type { Candle, SimConfig } from "@launchbot/sim-engine";
import { axisScale, chartUnit } from "./model.js";
import type { ChartUnit, SimToken } from "./model.js";
import { avatar, BAND_HEIGHT, COLORS, demoBand, document, line, rect, text, WIDTH } from "./svg.js";
import type { Logo } from "./svg.js";

/** What one picture of the running simulation shows (§6.1): the caller reads it off the run. */
export type ChartFrame = {
  token: SimToken;
  clock: { nowSec: number; durationSec: number };
  /** All the candles of the run so far, 5 simulated seconds each, in order. */
  candles: readonly Candle[];
  /** The curve and the frozen SOL price: the unit and the scale of the value axis. */
  config: Pick<SimConfig, "curve" | "solUsdPrice">;
  logo: Logo | null;
};

// Geometry, in pixels of the 1280 × 720 canvas.
const MARGIN = 32;
const PLOT_LEFT = MARGIN;
const PLOT_RIGHT = 1150;
const LABEL_X = WIDTH - MARGIN;
const PRICE_TOP = BAND_HEIGHT + 90;
const PRICE_BOTTOM = 536;
const VOLUME_TOP = 556;
const VOLUME_BOTTOM = 672;
const TIME_LABEL_Y = 704;
const HEADER_Y = 88;
const TIME_TICK_SEC = 30;
const VALUE_TICKS = 5;
/** Margin above the highest and below the lowest value, as a share of the range. */
const VALUE_MARGIN = 0.08;
const BODY_SHARE = 0.6;
const WICK_WIDTH = 2;

/** `$5,176`, `$52.10`, `52.1 SOL`, `0.52 SOL`: an axis label, without needless decimals. */
export function formatAxisValue(value: number, unit: ChartUnit): string {
  if (unit === "USD") return value >= 1000 ? `$${formatInt(Math.round(value))}` : formatUsd(value);
  return `${value.toFixed(value >= 100 ? 1 : 2)} SOL`;
}

type Range = { lo: number; hi: number };

/** The value axis: the lows and highs with a margin, and a flat range widened by 5 %. */
function valueRange(candles: readonly Candle[], scale: number): Range {
  if (candles.length === 0) return { lo: 0, hi: scale };
  let lo = Infinity;
  let hi = -Infinity;
  for (const candle of candles) {
    lo = Math.min(lo, candle.low * scale);
    hi = Math.max(hi, candle.high * scale);
  }
  if (hi === lo) {
    lo *= 0.95;
    hi *= 1.05;
  }
  const margin = (hi - lo) * VALUE_MARGIN;
  return { lo: Math.max(0, lo - margin), hi: hi + margin };
}

/**
 * The picture of the running simulation: DEMO band, token and clock, candles on a time axis
 * fixed on the whole duration (the chart fills from left to right, proposal), volume below.
 */
export function buildChartSvg(frame: ChartFrame): string {
  const { token, clock, candles, config, logo } = frame;
  const unit = chartUnit(config);
  const scale = axisScale(config);
  const { image } = en.sim;
  const parts: string[] = [demoBand(image.demo)];

  // Header: avatar, name · $TICKER, the clock on the right, the unit of the axis under them.
  parts.push(avatar(MARGIN + 24, HEADER_Y - 8, 24, token.ticker, logo));
  parts.push(
    text(MARGIN + 64, HEADER_Y, `${token.name} · ${formatTicker(token.ticker)}`, {
      size: 26,
      weight: 700,
      className: "title",
    }),
  );
  parts.push(
    text(LABEL_X, HEADER_Y, `${formatClock(clock.nowSec)} / ${formatClock(clock.durationSec)}`, {
      size: 26,
      anchor: "end",
      className: "clock",
    }),
  );
  parts.push(
    text(PLOT_LEFT, PRICE_TOP - 16, image.marketCap(unit), {
      size: 16,
      fill: COLORS.muted,
      className: "axis-unit",
    }),
  );

  // Time axis: one slot per candle interval, a grid line and a label every 30 s.
  const slots = Math.max(1, Math.ceil(clock.durationSec / CANDLE_INTERVAL_SEC));
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const slotWidth = plotWidth / slots;
  const xOf = (sec: number): number => PLOT_LEFT + (sec / clock.durationSec) * plotWidth;
  for (let sec = 0; sec <= clock.durationSec; sec += TIME_TICK_SEC) {
    const x = xOf(sec);
    parts.push(line(x, PRICE_TOP, x, VOLUME_BOTTOM, COLORS.grid));
    parts.push(
      text(x, TIME_LABEL_Y, formatClock(sec), {
        size: 16,
        fill: COLORS.muted,
        anchor: sec === 0 ? "start" : sec === clock.durationSec ? "end" : "middle",
        className: "time-tick",
      }),
    );
  }

  // Value axis: 5 grid lines with their label on the right.
  const { lo, hi } = valueRange(candles, scale);
  const yOf = (value: number): number =>
    PRICE_BOTTOM - ((value - lo) / (hi - lo)) * (PRICE_BOTTOM - PRICE_TOP);
  for (let i = 0; i < VALUE_TICKS; i += 1) {
    const value = lo + ((hi - lo) * i) / (VALUE_TICKS - 1);
    const y = yOf(value);
    parts.push(line(PLOT_LEFT, y, PLOT_RIGHT, y, COLORS.grid));
    parts.push(
      text(LABEL_X, y + 6, formatAxisValue(value, unit), {
        size: 16,
        fill: COLORS.muted,
        anchor: "end",
        className: "value-tick",
      }),
    );
  }

  // Candles and volume, one slot each.
  const bodyWidth = slotWidth * BODY_SHARE;
  const maxVolume = Math.max(...candles.map((candle) => candle.volumeSol), 0);
  for (const candle of candles) {
    const index = Math.round(candle.time / CANDLE_INTERVAL_SEC);
    const cx = PLOT_LEFT + (index + 0.5) * slotWidth;
    const up = candle.close >= candle.open;
    const color = up ? COLORS.up : COLORS.down;
    const top = yOf(Math.max(candle.open, candle.close) * scale);
    const bottom = yOf(Math.min(candle.open, candle.close) * scale);
    parts.push(
      `<g class="candle ${up ? "up" : "down"}">` +
        line(cx, yOf(candle.high * scale), cx, yOf(candle.low * scale), color, WICK_WIDTH) +
        rect(cx - bodyWidth / 2, top, bodyWidth, Math.max(1, bottom - top), color) +
        "</g>",
    );
    if (maxVolume > 0) {
      const height = (candle.volumeSol / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);
      parts.push(
        rect(
          cx - bodyWidth / 2,
          VOLUME_BOTTOM - height,
          bodyWidth,
          height,
          color,
          'opacity="0.4" class="volume"',
        ),
      );
    }
  }
  parts.push(line(PLOT_LEFT, VOLUME_BOTTOM, PLOT_RIGHT, VOLUME_BOTTOM, COLORS.grid));

  return document(parts.join(""));
}
