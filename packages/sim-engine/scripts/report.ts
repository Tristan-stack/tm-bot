/* eslint-disable no-console -- a tuning report, printed for a human (proposal, V1-19). */
/**
 * `pnpm --filter @launchbot/sim-engine sim:report [seeds]`: per preset, over seeds
 * 1..N on the fallback curve without a sell of the dev, the mean number of trades, the
 * final price over the price after the dev buy and the bundle (p1 / p50 / p99), the share of
 * runs that complete the curve and the share of candidates the guard raised. To tune "by eye".
 */
import { BondingCurve, FALLBACK_CURVE_PARAMS } from "../src/curve.js";
import { createTradeFlow } from "../src/flow.js";
import { presetForAmount, PRESET_TABLE } from "../src/presets.js";

const seeds = Number(process.argv[2] ?? "1000");
const DURATION = 180;
/** The fixed dev buy of the bot (`DEV_BUY_SOL` of @launchbot/shared), before the bundle. */
const DEV_BUY_SOL = 1;

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;

console.log(
  `preset | trades | ratio p1 | p50 | p99 | complete | under envelope (seeds 1..${seeds})`,
);
for (const { sol: bundleSol } of PRESET_TABLE) {
  const preset = presetForAmount(bundleSol);
  const ratios: number[] = [];
  let trades = 0;
  let complete = 0;
  let candidates = 0;
  let underEnvelope = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const curve = new BondingCurve(FALLBACK_CURVE_PARAMS);
    curve.buy(DEV_BUY_SOL);
    curve.buy(bundleSol);
    const reference = curve.price();
    const flow = createTradeFlow({ seed, preset, curve, durationSec: DURATION });
    trades += flow.advanceTo(DURATION).length;
    ratios.push(curve.price() / reference);
    if (curve.isComplete()) complete += 1;
    const stats = flow.stats();
    candidates += stats.candidates;
    underEnvelope += stats.underEnvelope;
  }
  ratios.sort((a, b) => a - b);
  const pct = (n: number, d: number): string => `${((100 * n) / d).toFixed(1)}%`;
  console.log(
    [
      `${DEV_BUY_SOL} + ${bundleSol} SOL`,
      (trades / seeds).toFixed(0),
      `×${percentile(ratios, 1).toFixed(2)}`,
      `×${percentile(ratios, 50).toFixed(2)}`,
      `×${percentile(ratios, 99).toFixed(2)}`,
      pct(complete, seeds),
      pct(underEnvelope, candidates),
    ].join(" | "),
  );
}
