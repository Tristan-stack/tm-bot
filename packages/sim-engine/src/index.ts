/** Seeded launch simulation engine. Pure TypeScript, no network, no Node API. */

/**
 * Bumped whenever an algorithm or a constant of the engine changes: a stored simulation
 * replays identically only with the version that produced it (proposal, V1-18).
 */
export const SIM_ENGINE_VERSION = 1;

// The public surface is what the cards V1-18 to V1-20 promise to the later tickets. The
// schedule and the trader registry stay internal to the flow.
export type {
  CurveParams,
  CurveState,
  DevSale,
  EndReason,
  Holder,
  Position,
  PresetParams,
  SimConfig,
  SimRun,
  TradeEvent,
} from "./types.js";
export { CurveCompleteError, SimulationEndedError } from "./errors.js";
export { createRng, deriveSeed, isValidSeed } from "./rng.js";
export type { Rng } from "./rng.js";
export { dmath } from "./dmath.js";
export {
  bernoulli,
  exponential,
  logNormal,
  logNormalBounded,
  normal,
  standardNormal,
} from "./distributions.js";
export {
  assertCurveParams,
  BondingCurve,
  curveProgress,
  devBuySupplyShare,
  DUST_TOKENS,
  FALLBACK_CURVE_PARAMS,
  marketCapSol,
  TOKEN_DECIMALS,
} from "./curve.js";
export type { BuyQuote, SellQuote } from "./curve.js";
export {
  assertPresetParams,
  MAX_TRADE_SOL,
  MIN_TRADE_SOL,
  PRESET_SIGMA,
  PRESET_TABLE,
  presetForDevBuy,
} from "./presets.js";
export { DEFAULT_FLOW_PARAMS } from "./schedule.js";
export type { FlowParams } from "./schedule.js";
export { createTradeFlow } from "./flow.js";
export type { TradeFlow, TradeFlowOptions } from "./flow.js";
export {
  assertSimConfig,
  createSimulation,
  DEV_DUMP_PANIC_SHARE,
  DEV_SELL_FRACTIONS,
} from "./simulation.js";
export type { SimulationRun } from "./simulation.js";
export { CANDLE_INTERVAL_SEC, createCandleAggregator } from "./candles.js";
export type { Candle, CandleAggregator } from "./candles.js";
