import type { BondingCurve } from "./curve.js";
import { settleTokens } from "./curve.js";
import { bernoulli, exponential, logNormalBounded } from "./distributions.js";
import { checkPositive, rangeError } from "./errors.js";
import { assertPresetParams } from "./presets.js";
import { createRng, deriveSeed } from "./rng.js";
import type { Rng } from "./rng.js";
import { createSchedule, DEFAULT_FLOW_PARAMS } from "./schedule.js";
import type { FlowParams } from "./schedule.js";
import { TraderRegistry } from "./traders.js";
import type { Trader } from "./traders.js";
import type { PresetParams, TradeEvent } from "./types.js";

/** One sub-stream per kind of draw, so a branch never shifts the others (§3 of V1-19). */
const STREAM = {
  schedule: 1,
  arrivals: 2,
  sides: 3,
  sizes: 4,
  traders: 5,
  addresses: 6,
} as const;

export interface TradeFlow {
  /** Every trade at an instant ≤ min(tSec, durationSec), applied to the curve, in order. */
  advanceTo(tSec: number): TradeEvent[];
  /** After a sell of the dev: the envelope restarts from the current price. */
  resetEnvelope(tSec: number): void;
  /**
   * The dev dumped everything (§6.2, proposal of 24/09/2026): every holder sells `share` of
   * its tokens at the same instant, the biggest first, and the curve falls back near its launch.
   */
  panic(tSec: number, share: number): TradeEvent[];
  /** The instant of the next candidate, drawn ahead of time. */
  nextTradeTime(): number;
  /** The curve is complete, or no candidate is left before durationSec. */
  done(): boolean;
  /** The live registry, in creation order: read it, never keep it across a trade. */
  traders(): ReadonlyArray<Readonly<Trader>>;
  /** λ(t), for the tests. */
  intensityAt(tSec: number): number;
  /** Effective pBuy at t, guard included. */
  pBuyAt(tSec: number): number;
  envelopeAt(tSec: number): number;
  /** Candidates drawn so far and how many the guard raised (for the report script). */
  stats(): { candidates: number; underEnvelope: number };
}

export type TradeFlowOptions = {
  seed: number;
  preset: PresetParams;
  /** Shared with the caller (V1-20 sells the dev's tokens on the same instance). */
  curve: BondingCurve;
  durationSec: number;
  params?: FlowParams;
};

/**
 * The trade flow of §7.2: Poisson arrivals at the intensity λ(t) of the schedule, a side
 * by Bernoulli on the pBuy of the phase (raised by the bullish guard), a log-normal size,
 * and a trader from the registry. Only the instant of the next candidate is drawn ahead:
 * its side, size and trader are drawn when it is applied, with the price of that moment.
 * Each candidate consumes the same draws whatever its branch: 1 arrival, 1 side, 2 sizes,
 * 2 traders. The dev is never drawn.
 */
export function createTradeFlow(options: TradeFlowOptions): TradeFlow {
  const { seed, preset, curve, durationSec, params = DEFAULT_FLOW_PARAMS } = options;
  assertPresetParams(preset);
  checkPositive(durationSec, "durationSec");

  const stream = (id: number): Rng => createRng(deriveSeed(seed, id));
  const schedule = createSchedule(stream(STREAM.schedule), {
    durationSec,
    pBuy: preset.pBuy,
    params,
  });
  const arrivals = stream(STREAM.arrivals);
  const sides = stream(STREAM.sides);
  const sizes = stream(STREAM.sizes);
  const traderDraws = stream(STREAM.traders);
  const registry = new TraderRegistry(stream(STREAM.addresses));

  const envelope = { priceRef: curve.price(), tRef: 0 };
  let lastTarget = 0;
  let candidates = 0;
  let underEnvelope = 0;

  const intensityAt = (t: number): number => preset.lambda0 * schedule.factorAt(t);
  const envelopeAt = (t: number): number =>
    envelope.priceRef *
    (1 + params.envelope.slopePerSec * (t - envelope.tRef)) *
    (1 - params.envelope.margin);
  const guardRaises = (t: number): boolean => curve.price() < envelopeAt(t);
  const pBuyAt = (t: number, raised: boolean): number => {
    const phase = schedule.pBuyAt(t);
    return raised ? Math.max(phase, params.envelope.pBuyRecovery) : phase;
  };

  /** The next arrival, from the intensity at the previous candidate (§7.2, read literally). */
  const drawNext = (from: number): number => from + exponential(arrivals, intensityAt(from));
  let nextAt = drawNext(0);

  /** Draws and applies the candidate at `t`; undefined for an ignored sell. */
  function applyCandidate(t: number): TradeEvent | undefined {
    const raised = guardRaises(t);
    candidates += 1;
    if (raised) underEnvelope += 1;
    const isBuy = bernoulli(sides, pBuyAt(t, raised));
    const size = logNormalBounded(sizes, preset.mu, preset.sigma, preset.minTrade, preset.maxTrade);
    const u1 = traderDraws.next();
    const u2 = traderDraws.next();

    if (isBuy) {
      const existing = u1 < params.newTraderProb ? undefined : registry.pickAny(u2);
      const trader = existing ?? registry.create();
      const quote = curve.buy(size);
      trader.tokens += quote.tokensOut;
      return {
        t,
        side: "buy",
        trader: trader.address,
        sol: quote.solUsed,
        tokens: quote.tokensOut,
        price: curve.price(),
      };
    }

    const holder = registry.pickHolder(u2);
    if (holder === undefined) return undefined;
    // Sized in SOL, never beyond the holdings; a size at or past the reserve sells everything.
    const quote = curve.sell(Math.min(holder.tokens, curve.tokensForGrossSolOut(size)));
    holder.tokens = settleTokens(holder.tokens - quote.tokensIn);
    return {
      t,
      side: "sell",
      trader: holder.address,
      sol: quote.solOut,
      tokens: quote.tokensIn,
      price: curve.price(),
    };
  }

  return {
    advanceTo(tSec) {
      if (!(tSec >= lastTarget)) {
        throw rangeError("tSec", `a number ≥ ${lastTarget}, the previous target`);
      }
      const target = Math.min(tSec, durationSec);
      lastTarget = target;
      const events: TradeEvent[] = [];
      while (!curve.isComplete() && nextAt <= target) {
        const t = nextAt;
        const event = applyCandidate(t);
        if (event !== undefined) events.push(event);
        nextAt = drawNext(t);
      }
      return events;
    },
    resetEnvelope(tSec) {
      envelope.priceRef = curve.price();
      envelope.tRef = tSec;
    },
    panic(tSec, share) {
      const events: TradeEvent[] = [];
      for (const holder of registry.holders()) {
        const quote = curve.sell(holder.tokens * share);
        holder.tokens = settleTokens(holder.tokens - quote.tokensIn);
        events.push({
          t: tSec,
          side: "sell",
          trader: holder.address,
          sol: quote.solOut,
          tokens: quote.tokensIn,
          price: curve.price(),
        });
      }
      return events;
    },
    nextTradeTime: () => nextAt,
    done: () => curve.isComplete() || nextAt > durationSec,
    traders: () => registry.list(),
    intensityAt,
    pBuyAt: (t) => pBuyAt(t, guardRaises(t)),
    envelopeAt,
    stats: () => ({ candidates, underEnvelope }),
  };
}
