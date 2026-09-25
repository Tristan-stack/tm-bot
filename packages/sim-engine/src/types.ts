/**
 * Types of the engine, copied from §7.4 of the context. V1-18 defines the curve types,
 * V1-19 adds the preset and the trade event, V1-20 completes the block.
 */

export type CurveParams = {
  virtualSol: number;
  virtualTokens: number;
  realTokens: number;
  totalSupply: number;
  feeRate: number;
};

export type PresetParams = {
  lambda0: number;
  pBuy: number;
  mu: number;
  sigma: number;
  minTrade: number;
  maxTrade: number;
};

export type TradeEvent = {
  /** Simulated seconds. */
  t: number;
  side: "buy" | "sell";
  /** Short simulated address, or "dev". */
  trader: string;
  /** Buy: SOL paid, fees included. Sell: SOL received, fees deducted. */
  sol: number;
  tokens: number;
  /** Price after the trade. */
  price: number;
};

export type CurveState = {
  x: number;
  y: number;
  realTokens: number;
  price: number;
};

export type SimConfig = {
  seed: number;
  devBuySol: number;
  /**
   * The bundle (decision of 25/09/2026): a second buy of the dev, from the same wallet, in the
   * next block. The engine has no blocks: it lands right after the dev buy, before the first
   * trader. 0 for none: a run with its dev buy alone (the simulations made before the bundle,
   * and their Run again).
   */
  bundleSol: number;
  durationSec: number;
  curve: CurveParams;
  preset: PresetParams;
  /** Frozen when the simulation is created; USD hidden when null. */
  solUsdPrice: number | null;
};

export type Position = {
  /** Tokens still held. */
  tokens: number;
  /** Dev buy and bundle, fees included. */
  solIn: number;
  /** SOL received from the sells, fees deducted. */
  solOut: number;
  /** SOL if the rest were sold now, price impact included. */
  valueIfSoldNow: number;
  /** solOut + valueIfSoldNow − solIn. */
  pnlSol: number;
  pnlPct: number;
};

export type Holder = {
  address: string;
  tokens: number;
  pctSupply: number;
  label?: "bonding_curve" | "dev";
};

export type EndReason = "timeout" | "position_closed" | "curve_complete";

/** The sale of the dev, and the sells of the holders it triggered (empty unless everything went). */
export type DevSale = { event: TradeEvent; panic: TradeEvent[] };

export interface SimRun {
  step(dtSec: number): TradeEvent[];
  /** 0.25, 0.5 or 1; the whole position sold makes the holders panic (`DEV_DUMP_PANIC_SHARE`). */
  sellDev(fraction: number): DevSale;
  state(): CurveState;
  position(): Position;
  topHolders(limit: number): Holder[];
  endReason(): EndReason | null;
}
