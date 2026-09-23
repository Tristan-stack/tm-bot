import { describe, expect, it } from "vitest";
import { BondingCurve, DUST_TOKENS, FALLBACK_CURVE_PARAMS } from "./curve.js";
import { createTradeFlow } from "./flow.js";
import type { TradeFlow } from "./flow.js";
import { presetForDevBuy } from "./presets.js";
import { DEFAULT_FLOW_PARAMS } from "./schedule.js";
import { BASE58_ALPHABET } from "./traders.js";
import type { TradeEvent } from "./types.js";

const DURATION = 180;
const P = FALLBACK_CURVE_PARAMS;

/** A curve after the dev buy of `devBuySol`, and the flow on it. */
function setup(
  seed: number,
  devBuySol = 3,
  durationSec = DURATION,
  params = P,
): { curve: BondingCurve; flow: TradeFlow; devTokens: number; priceAfterDevBuy: number } {
  const curve = new BondingCurve(params);
  const devTokens = curve.buy(devBuySol).tokensOut;
  const priceAfterDevBuy = curve.price();
  const flow = createTradeFlow({ seed, preset: presetForDevBuy(devBuySol), curve, durationSec });
  return { curve, flow, devTokens, priceAfterDevBuy };
}

const runWhole = (seed: number): TradeEvent[] => setup(seed).flow.advanceTo(DURATION);

describe("createTradeFlow", () => {
  it("replays exactly the same events from the same seed and preset", () => {
    const events = runWhole(1);
    expect(events.length).toBeGreaterThan(50);
    expect(runWhole(1)).toEqual(events);
    expect(runWhole(2)).not.toEqual(events);
  });

  it("gives the same events whether advanced at once, by 1/60 s or by irregular steps", () => {
    const wholeRun = setup(4);
    const whole = wholeRun.flow.advanceTo(DURATION);

    const sixty = setup(4);
    const bySixty: TradeEvent[] = [];
    for (let k = 1; k <= DURATION * 60; k += 1) bySixty.push(...sixty.flow.advanceTo(k / 60));
    expect(bySixty).toEqual(whole);
    expect(sixty.curve.state()).toEqual(wholeRun.curve.state());

    const irregular = setup(4);
    const byIrregular: TradeEvent[] = [];
    const steps = [0.3, 1.7, 0.01, 12.5, 0.5, 33, 0.016, 7, 20, 60, 100];
    let t = 0;
    for (const step of steps) {
      t += step;
      byIrregular.push(...irregular.flow.advanceTo(t));
    }
    expect(byIrregular).toEqual(whole);
  });

  it("produces events with the convention of §7.4, in order, never beyond durationSec", () => {
    const events = runWhole(6);
    let last = 0;
    for (const event of events) {
      expect(event.t).toBeGreaterThanOrEqual(last);
      expect(event.t).toBeLessThanOrEqual(DURATION);
      expect(event.trader).toMatch(
        new RegExp(`^[${BASE58_ALPHABET}]{4}…[${BASE58_ALPHABET}]{4}$`, "u"),
      );
      expect(event.sol).toBeGreaterThan(0);
      expect(event.tokens).toBeGreaterThan(0);
      expect(event.price).toBeGreaterThan(0);
      last = event.t;
    }
    expect(events.some((e) => e.side === "buy")).toBe(true);
    expect(events.some((e) => e.side === "sell")).toBe(true);
  });

  it("never sells more than a trader holds and conserves the tokens", () => {
    for (const seed of [7, 8, 9]) {
      const { curve, flow, devTokens } = setup(seed);
      const held = new Map<string, number>();
      let t = 0;
      while (t < DURATION) {
        t += 5;
        for (const event of flow.advanceTo(t)) {
          const before = held.get(event.trader) ?? 0;
          if (event.side === "sell") expect(event.tokens).toBeLessThanOrEqual(before + 1e-6);
          held.set(event.trader, before + (event.side === "buy" ? event.tokens : -event.tokens));
        }
        const traders = flow.traders().reduce((sum, trader) => sum + trader.tokens, 0);
        expect(Math.abs(traders + devTokens - curve.circulatingTokens())).toBeLessThanOrEqual(1e-3);
      }
      for (const trader of flow.traders()) expect(trader.tokens).toBeGreaterThanOrEqual(0);
    }
  });

  it("has about 0.6 of the buys made by a new trader, aggregated over 200 seeds", () => {
    let buys = 0;
    let fromNew = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const seen = new Set<string>();
      for (const event of runWhole(seed)) {
        if (event.side !== "buy") continue;
        buys += 1;
        if (!seen.has(event.trader)) {
          fromNew += 1;
          seen.add(event.trader);
        }
      }
    }
    // The first buy of a run always creates a trader: a hair above 0.6.
    expect(Math.abs(fromNew / buys - 0.6)).toBeLessThanOrEqual(0.02);
  });

  it("raises pBuy to 0.85 while the price is under the envelope, and restarts it on reset", () => {
    const { curve, flow, devTokens } = setup(10);
    flow.advanceTo(20);
    expect(flow.pBuyAt(20)).toBeLessThan(0.85);
    // The dev dumps on the curve directly: the price falls under the envelope.
    curve.sell(devTokens);
    expect(curve.price()).toBeLessThan(flow.envelopeAt(20));
    expect(flow.pBuyAt(20)).toBeGreaterThanOrEqual(0.85);
    flow.resetEnvelope(20);
    expect(flow.envelopeAt(20)).toBeCloseTo(
      curve.price() * (1 - DEFAULT_FLOW_PARAMS.envelope.margin),
      15,
    );
    expect(flow.pBuyAt(20)).toBeLessThan(0.85);
    expect(flow.envelopeAt(120)).toBeCloseTo(flow.envelopeAt(20) * (1 + 0.002 * 100), 12);
  });

  it("keeps the next trade time on a direct sell but lets the next candidate see it", () => {
    const a = setup(12);
    const b = setup(12);
    a.flow.advanceTo(30);
    b.flow.advanceTo(30);
    const nextAt = a.flow.nextTradeTime();
    expect(nextAt).toBeGreaterThan(30);
    a.curve.sell(a.devTokens);
    expect(a.flow.nextTradeTime()).toBe(nextAt);
    const afterA = a.flow.advanceTo(nextAt + 0.001);
    const afterB = b.flow.advanceTo(nextAt + 0.001);
    expect(afterA.length).toBe(afterB.length);
    if (afterA[0] === undefined || afterB[0] === undefined) return;
    expect(afterA[0].t).toBe(afterB[0].t);
    expect(afterA[0].price).not.toBe(afterB[0].price);
  });

  it("stops after a buy completes the curve and after durationSec", () => {
    const tiny = { ...P, realTokens: 120_000_000, virtualTokens: 400_000_000 };
    const { curve, flow } = setup(3, 10, DURATION, tiny);
    const events = flow.advanceTo(DURATION);
    expect(curve.isComplete()).toBe(true);
    expect(flow.done()).toBe(true);
    const last = events[events.length - 1];
    expect(last?.side).toBe("buy");
    expect(last?.t).toBeLessThan(DURATION);
    expect(flow.advanceTo(DURATION)).toEqual([]);

    const normal = setup(3);
    normal.flow.advanceTo(DURATION);
    expect(normal.flow.done()).toBe(true);
    expect(normal.flow.advanceTo(500)).toEqual([]);
    expect(normal.flow.nextTradeTime()).toBeGreaterThan(DURATION);
  });

  it("refuses to go back in time, a bad preset or a bad duration", () => {
    const { flow, curve } = setup(1);
    flow.advanceTo(10);
    expect(() => flow.advanceTo(9)).toThrow(RangeError);
    expect(() => flow.advanceTo(NaN)).toThrow(RangeError);
    const preset = presetForDevBuy(3);
    expect(() => createTradeFlow({ seed: 1, preset, curve, durationSec: 0 })).toThrow(RangeError);
    expect(() =>
      createTradeFlow({ seed: 1, preset: { ...preset, pBuy: 2 }, curve, durationSec: 180 }),
    ).toThrow(/pBuy/);
  });

  it("exposes the intensity λ0·m(t) and its stats", () => {
    const { flow } = setup(2);
    expect(flow.intensityAt(0)).toBeGreaterThanOrEqual(0.8 * 0.2);
    flow.advanceTo(DURATION);
    const stats = flow.stats();
    expect(stats.candidates).toBeGreaterThan(0);
    expect(stats.underEnvelope).toBeLessThanOrEqual(stats.candidates);
  });

  it("handles a curve already complete or a trader left with dust", () => {
    const curve = new BondingCurve(P);
    curve.buy(200);
    const flow = createTradeFlow({ seed: 1, preset: presetForDevBuy(3), curve, durationSec: 10 });
    expect(flow.done()).toBe(true);
    expect(flow.advanceTo(10)).toEqual([]);
    for (const trader of setup(15).flow.traders()) {
      expect(trader.tokens === 0 || trader.tokens > DUST_TOKENS).toBe(true);
    }
  });
});

describe("acceptance (§15): the flow is bullish without a sell of the dev", () => {
  it.each([3, 5, 10])(
    "ends above the price after a dev buy of %s SOL for seeds 1 to 1 000",
    (devBuySol) => {
      let above = 0;
      for (let seed = 1; seed <= 1_000; seed += 1) {
        const { curve, flow, priceAfterDevBuy } = setup(seed, devBuySol);
        flow.advanceTo(DURATION);
        if (curve.price() > priceAfterDevBuy) above += 1;
      }
      expect(above).toBe(1_000);
    },
  );
});
