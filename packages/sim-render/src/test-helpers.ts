import type { Candle } from "@launchbot/sim-engine";
import { simConfig } from "@launchbot/sim-engine/test-helpers";
import type { ChartFrame } from "./chart.js";
import type { PnlCardModel } from "./model.js";

/** A candle of the tests: wicks 10 % beyond the body, one buy. */
export const candle = (time: number, open: number, close: number, volumeSol = 1): Candle => ({
  time,
  open,
  high: Math.max(open, close) * 1.1,
  low: Math.min(open, close) * 0.9,
  close,
  volumeSol,
  buys: 1,
  sells: 0,
});

/** Moon Otter at 1:32 of 3:00, two candles, USD with SOL at 150. */
export const chartFrame = (overrides: Partial<ChartFrame> = {}): ChartFrame => ({
  token: { name: "Moon Otter", ticker: "OTTR" },
  clock: { nowSec: 92, durationSec: 180 },
  candles: [candle(0, 2e-8, 3e-8, 3), candle(5, 3e-8, 2.5e-8, 1.5)],
  config: simConfig(),
  logo: null,
  ...overrides,
});

/** The card of the mock-up of §6.3: +42.7 %, closed at 2:14. */
export const pnlCard = (overrides: Partial<PnlCardModel> = {}): PnlCardModel => ({
  tickerText: "$OTTR",
  ticker: "OTTR",
  pnlSolBig: "+1.283",
  pnlPctText: "+42.7%",
  investedText: "3.000",
  positionSolText: "4.283",
  usd: { invested: "$310", position: "$443", pnl: "$133" },
  tone: "positive",
  ...overrides,
});
