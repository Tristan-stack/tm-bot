import { describe, expect, it } from "vitest";
import { CANDLE_INTERVAL_SEC, createCandleAggregator } from "./candles.js";
import { FALLBACK_CURVE_PARAMS } from "./curve.js";
import { createSimulation } from "./simulation.js";
import { simConfig } from "./test-helpers.js";
import type { TradeEvent } from "./types.js";

const INITIAL = FALLBACK_CURVE_PARAMS.virtualSol / FALLBACK_CURVE_PARAMS.virtualTokens;
const event = (t: number, price: number, side: "buy" | "sell" = "buy", sol = 1): TradeEvent => ({
  t,
  side,
  trader: "AAAA…BBBB",
  sol,
  tokens: 1,
  price,
});

describe("createCandleAggregator", () => {
  it("opens the first candle at the initial price and includes the jump of the dev buy", () => {
    const sim = createSimulation(simConfig({ seed: 1, solUsdPrice: null }));
    const aggregator = createCandleAggregator({ initialPrice: INITIAL, durationSec: 180 });
    const [first] = aggregator.push([sim.devBuy()], 0);
    expect(first).toMatchObject({
      time: 0,
      open: INITIAL,
      low: INITIAL,
      buys: 1,
      sells: 0,
      volumeSol: 3,
    });
    expect(first?.close).toBe(sim.devBuy().price);
    expect(first?.high).toBe(sim.devBuy().price);
    expect(CANDLE_INTERVAL_SEC).toBe(5);
  });

  it("buckets on 5 s, opens at the previous close and sums volume and counters", () => {
    const aggregator = createCandleAggregator({ initialPrice: 1, durationSec: 180 });
    const changed = aggregator.push(
      [event(1, 2), event(4.9, 1.5, "sell", 0.5), event(7, 3, "buy", 2)],
      7,
    );
    expect(changed.map((c) => c.time)).toEqual([0, 5]);
    expect(changed[0]).toEqual({
      time: 0,
      open: 1,
      high: 2,
      low: 1,
      close: 1.5,
      volumeSol: 1.5,
      buys: 1,
      sells: 1,
    });
    expect(changed[1]).toEqual({
      time: 5,
      open: 1.5,
      high: 3,
      low: 1.5,
      close: 3,
      volumeSol: 2,
      buys: 1,
      sells: 0,
    });
    expect(aggregator.candles()).toEqual(changed);
  });

  it("opens flat candles up to now when nothing trades, and returns only the touched ones", () => {
    const aggregator = createCandleAggregator({ initialPrice: 1, durationSec: 180 });
    aggregator.push([event(2, 4)], 2);
    const flat = aggregator.push([], 17);
    expect(flat.map((c) => c.time)).toEqual([5, 10, 15]);
    for (const candle of flat) {
      expect(candle).toMatchObject({
        open: 4,
        high: 4,
        low: 4,
        close: 4,
        volumeSol: 0,
        buys: 0,
        sells: 0,
      });
    }
    expect(aggregator.push([], 18)).toEqual([]);
    const next = aggregator.push([event(19, 5)], 19);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ time: 15, open: 4, close: 5, high: 5, low: 4 });
  });

  it("puts a trade at t = 180 in the last bucket, 175", () => {
    const aggregator = createCandleAggregator({ initialPrice: 1, durationSec: 180 });
    aggregator.push([event(180, 2)], 180);
    const candles = aggregator.candles();
    expect(candles[candles.length - 1]?.time).toBe(175);
    expect(candles).toHaveLength(36);
    expect(aggregator.push([], 500)).toEqual([]);
  });

  it("refuses an event before the current candle and bad options", () => {
    const aggregator = createCandleAggregator({ initialPrice: 1, durationSec: 180 });
    aggregator.push([event(12, 2)], 12);
    expect(() => aggregator.push([event(4, 2)], 12)).toThrow(RangeError);
    expect(() => aggregator.push([event(10.5, 2)], 12)).not.toThrow();
    expect(() => aggregator.push([event(-1, 2)], 12)).toThrow(/event.t/);
    expect(() => aggregator.push([], NaN)).toThrow(/nowSec/);
    expect(() => createCandleAggregator({ initialPrice: 0, durationSec: 180 })).toThrow(
      /initialPrice/,
    );
    expect(() => createCandleAggregator({ initialPrice: 1, durationSec: 0 })).toThrow(
      /durationSec/,
    );
    expect(() =>
      createCandleAggregator({ initialPrice: 1, durationSec: 10, intervalSec: -1 }),
    ).toThrow(/intervalSec/);
  });

  it("returns copies: a caller cannot alter the stored candles", () => {
    const aggregator = createCandleAggregator({ initialPrice: 1, durationSec: 180 });
    const [candle] = aggregator.push([event(1, 2)], 1);
    if (candle !== undefined) candle.close = 999;
    expect(aggregator.candles()[0]?.close).toBe(2);
  });

  it("follows a whole simulation frame by frame with strictly increasing times", () => {
    const sim = createSimulation(simConfig({ seed: 5, devBuySol: 5, solUsdPrice: null }));
    const aggregator = createCandleAggregator({ initialPrice: INITIAL, durationSec: 180 });
    aggregator.push([sim.devBuy()], 0);
    let trades = 1;
    let volume = sim.devBuy().sol;
    while (sim.endReason() === null) {
      const events = sim.step(1 / 30);
      trades += events.length;
      volume += events.reduce((sum, e) => sum + e.sol, 0);
      aggregator.push(events, sim.time());
    }
    const candles = aggregator.candles();
    expect(candles).toHaveLength(36);
    for (let i = 1; i < candles.length; i += 1) {
      expect(candles[i]?.time).toBe((candles[i - 1]?.time ?? 0) + 5);
      expect(candles[i]?.open).toBe(candles[i - 1]?.close);
    }
    expect(candles.reduce((sum, c) => sum + c.buys + c.sells, 0)).toBe(trades);
    expect(candles.reduce((sum, c) => sum + c.volumeSol, 0)).toBeCloseTo(volume, 9);
    expect(candles[candles.length - 1]?.close).toBe(sim.state().price);
  });
});
