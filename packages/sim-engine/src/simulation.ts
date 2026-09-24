import { assertCurveParams, BondingCurve, settleTokens } from "./curve.js";
import { checkPositive, isRecord, rangeError, SimulationEndedError } from "./errors.js";
import { createTradeFlow } from "./flow.js";
import { assertPresetParams } from "./presets.js";
import { isValidSeed } from "./rng.js";
import type { EndReason, Holder, Position, SimConfig, SimRun, TradeEvent } from "./types.js";

export const DEV_SELL_FRACTIONS = [0.25, 0.5, 1] as const;
/**
 * A Sell 100% of the dev makes every holder sell this share of its tokens at once (§6.2,
 * proposal of 24/09/2026): the market cap falls back near the launch, as after a rug.
 */
export const DEV_DUMP_PANIC_SHARE = 0.9;

/** Non-dyadic steps drift: 0.016 × 11 250 = 179.99999999998727. Within this, snap to the end. */
const CLOCK_SNAP_SEC = 1e-9;

const DEV = "dev";
const BONDING_CURVE = "bonding_curve";

/** The public run (§7.4), plus the clock and the dev buy event the screens need (proposal). */
export interface SimulationRun extends SimRun {
  /**
   * Advances to an absolute simulated instant, never before the current one: what a clock
   * kept outside the engine calls each frame (V1-26). `step(dt)` is `advanceTo(time() + dt)`.
   */
  advanceTo(tSec: number): TradeEvent[];
  /** Simulated seconds; frozen at the end ("Time 2:14" of the PNL card). */
  time(): number;
  /** The buy of the dev at t = 0, never returned by `step`. */
  devBuy(): TradeEvent;
}

/** A config as V1-22 stores it and V1-23 serves it: every field checked, RangeError naming it. */
export function assertSimConfig(config: unknown): asserts config is SimConfig {
  if (!isRecord(config)) throw rangeError("config", "an object");
  if (!isValidSeed(config.seed)) throw rangeError("seed", "an integer in [0, 4294967295]");
  checkPositive(config.devBuySol, "devBuySol");
  checkPositive(config.durationSec, "durationSec");
  assertCurveParams(config.curve);
  assertPresetParams(config.preset);
  if (config.solUsdPrice !== null) checkPositive(config.solUsdPrice, "solUsdPrice");
}

/** A frozen deep copy: the engine never touches the object it received. */
const freezeConfig = (config: SimConfig): Readonly<SimConfig> =>
  Object.freeze({
    seed: config.seed,
    devBuySol: config.devBuySol,
    durationSec: config.durationSec,
    curve: Object.freeze({ ...config.curve }),
    preset: Object.freeze({ ...config.preset }),
    solUsdPrice: config.solUsdPrice,
  });

/**
 * The engine behind one simulation (§7.4): the dev buy at t = 0, a simulated clock moved
 * by `step`, the sells of the dev through the curve, the position, the top holders and
 * the reason of the end. The only entry point of the web app and the bot.
 */
export function createSimulation(input: SimConfig): SimulationRun {
  assertSimConfig(input);
  const config = freezeConfig(input);
  const { totalSupply } = config.curve;
  const curve = new BondingCurve(config.curve);

  // The dev buys at t = 0, before the first simulated trade (§7.1).
  const devQuote = curve.buy(config.devBuySol);
  const devBuyEvent: TradeEvent = Object.freeze({
    t: 0,
    side: "buy",
    trader: DEV,
    sol: devQuote.solUsed,
    tokens: devQuote.tokensOut,
    price: curve.price(),
  });
  let devTokens = devQuote.tokensOut;
  const solIn = devQuote.solUsed;
  let solOut = 0;
  let time = 0;
  let end: EndReason | null = curve.isComplete() ? "curve_complete" : null;

  // The envelope of the guard starts from the price after the dev buy.
  const flow = createTradeFlow({
    seed: config.seed,
    preset: config.preset,
    curve,
    durationSec: config.durationSec,
  });

  const holder = (address: string, tokens: number, label?: Holder["label"]): Holder => ({
    address,
    tokens,
    pctSupply: (tokens / totalSupply) * 100,
    ...(label === undefined ? {} : { label }),
  });

  return {
    step(dtSec) {
      if (!(Number.isFinite(dtSec) && dtSec >= 0)) throw rangeError("dtSec", "a finite number ≥ 0");
      return this.advanceTo(time + dtSec);
    },

    advanceTo(tSec) {
      if (!(Number.isFinite(tSec) && tSec >= time)) {
        throw rangeError("tSec", `a finite number ≥ ${time}, the current time`);
      }
      if (end !== null) return [];
      let target = tSec;
      if (config.durationSec - target <= CLOCK_SNAP_SEC) target = config.durationSec;
      const events = flow.advanceTo(target);
      if (curve.isComplete()) {
        end = "curve_complete";
        time = events[events.length - 1]?.t ?? time;
        return events;
      }
      time = target;
      if (target >= config.durationSec) end = "timeout";
      return events;
    },

    sellDev(fraction) {
      if (end !== null) throw new SimulationEndedError();
      if (!DEV_SELL_FRACTIONS.some((allowed) => allowed === fraction)) {
        throw rangeError("fraction", `one of ${DEV_SELL_FRACTIONS.join(", ")}`);
      }
      // A fraction of the tokens still held (proposal); × 1 is exact, so 1 sells everything.
      const quote = curve.sell(devTokens * fraction);
      devTokens = settleTokens(devTokens - quote.tokensIn);
      solOut += quote.solOut;
      flow.resetEnvelope(time);
      const event: TradeEvent = {
        t: time,
        side: "sell",
        trader: DEV,
        sol: quote.solOut,
        tokens: quote.tokensIn,
        price: curve.price(),
      };
      if (devTokens > 0) return { event, panic: [] };
      end = "position_closed";
      return { event, panic: flow.panic(time, DEV_DUMP_PANIC_SHARE) };
    },

    state: () => curve.state(),

    position(): Position {
      // Through the curve, impact and fees included: never price × tokens (§6.2).
      const valueIfSoldNow = devTokens > 0 ? curve.quoteSell(devTokens).solOut : 0;
      const pnlSol = solOut + valueIfSoldNow - solIn;
      return {
        tokens: devTokens,
        solIn,
        solOut,
        valueIfSoldNow,
        pnlSol,
        pnlPct: (pnlSol / solIn) * 100,
      };
    },

    topHolders(limit) {
      if (!Number.isInteger(limit) || limit < 1) throw rangeError("limit", "an integer ≥ 1");
      // The unsold supply stays on the curve, as on pump.fun (proposal): 100 % at the start.
      const holders = [
        holder(BONDING_CURVE, totalSupply - curve.circulatingTokens(), BONDING_CURVE),
      ];
      if (devTokens > 0) holders.push(holder(DEV, devTokens, DEV));
      for (const trader of flow.traders()) {
        if (trader.tokens > 0) holders.push(holder(trader.address, trader.tokens));
      }
      holders.sort(
        (a, b) =>
          b.tokens - a.tokens || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0),
      );
      return holders.slice(0, limit);
    },

    endReason: () => end,
    time: () => time,
    devBuy: () => devBuyEvent,
  };
}
