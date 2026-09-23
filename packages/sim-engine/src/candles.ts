import { checkNumber, checkPositive, rangeError } from "./errors.js";
import type { TradeEvent } from "./types.js";

/** Candles aggregate the trades on a fixed interval of simulated seconds (§7.4). */
export const CANDLE_INTERVAL_SEC = 5;

export type Candle = {
  /** Start of the interval in simulated seconds: 0, 5, 10… strictly increasing. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeSol: number;
  buys: number;
  sells: number;
};

export interface CandleAggregator {
  /** Applies the events, then opens flat candles up to `nowSec`; the candles created or changed, in order. */
  push(events: readonly TradeEvent[], nowSec: number): Candle[];
  /** Every candle so far, as copies: a screen reads the return of `push` instead, each frame. */
  candles(): readonly Candle[];
}

/**
 * OHLC + volume on `intervalSec` buckets. The first candle opens at `initialPrice`, the
 * price before the dev buy, so pushing `devBuy()` first draws its jump. An interval with
 * no trade gets a flat candle (proposal): the chart moves on even when nothing trades.
 */
export function createCandleAggregator(options: {
  initialPrice: number;
  durationSec: number;
  intervalSec?: number;
}): CandleAggregator {
  const { initialPrice, durationSec, intervalSec = CANDLE_INTERVAL_SEC } = options;
  checkPositive(initialPrice, "initialPrice");
  checkPositive(durationSec, "durationSec");
  checkPositive(intervalSec, "intervalSec");
  // 175 for 180 s on 5 s: a trade at exactly t = durationSec lands in the last candle.
  const lastBucket = (Math.ceil(durationSec / intervalSec) - 1) * intervalSec;
  const bucketOf = (t: number): number =>
    Math.min(Math.floor(t / intervalSec) * intervalSec, lastBucket);
  const timeOf = (t: unknown, name: string): number =>
    checkNumber(t, name, "a finite number ≥ 0", (n) => Number.isFinite(n) && n >= 0);

  const candles: Candle[] = [];
  const copy = (candle: Candle): Candle => ({ ...candle });

  /** The candle of `bucket`, opening flat candles up to it when needed. */
  function candleAt(bucket: number): Candle {
    let last = candles[candles.length - 1];
    if (last !== undefined && bucket < last.time) {
      throw rangeError("event.t", `in the current candle (${last.time}) or later`);
    }
    for (
      let next = last === undefined ? 0 : last.time + intervalSec;
      next <= bucket;
      next += intervalSec
    ) {
      const open = last?.close ?? initialPrice;
      last = {
        time: next,
        open,
        high: open,
        low: open,
        close: open,
        volumeSol: 0,
        buys: 0,
        sells: 0,
      };
      candles.push(last);
    }
    if (last === undefined) throw new Error("unreachable: bucket ≥ 0 opens a candle");
    return last;
  }

  return {
    push(events, nowSec) {
      // The touched candles are always a contiguous tail: the current one and the new ones.
      let first = candles.length;
      for (const event of events) {
        const candle = candleAt(bucketOf(timeOf(event.t, "event.t")));
        first = Math.min(first, candles.length - 1);
        candle.high = Math.max(candle.high, event.price);
        candle.low = Math.min(candle.low, event.price);
        candle.close = event.price;
        candle.volumeSol += event.sol;
        if (event.side === "buy") candle.buys += 1;
        else candle.sells += 1;
      }
      candleAt(bucketOf(timeOf(nowSec, "nowSec")));
      return candles.slice(first).map(copy);
    },
    candles: () => candles.map(copy),
  };
}
