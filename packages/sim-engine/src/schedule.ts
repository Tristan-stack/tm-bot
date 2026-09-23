import { clamp, dmath, TWO_PI } from "./dmath.js";
import { exponential, pickWeighted, uniform } from "./distributions.js";
import type { Rng } from "./rng.js";

/**
 * The organic parameters of the flow (§7.2). They are constants of the engine, not part
 * of `SimConfig`: changing one changes the replay of stored simulations, so bump
 * `SIM_ENGINE_VERSION` with it. Every value here is a proposal, "to adjust by eye" (§7.3).
 */
export type FlowParams = {
  /** A buy comes from a new trader with this probability (§7.2). */
  newTraderProb: number;
  /** Slow wave of the intensity: 1 + amplitude·sin(2π·t/period + φ), floored. */
  wave: { amplitude: number; periodSec: number; floor: number };
  /** Bursts: a Poisson process of instants, each adding amplitude·exp(−(t − tb)/decay). */
  bursts: { meanIntervalSec: number; amplitudeMin: number; amplitudeMax: number; decaySec: number };
  /** pBuy phases: durations U[min, max], a kind drawn by weight, its offset added to pBuy. */
  phases: {
    minSec: number;
    maxSec: number;
    kinds: { weight: number; offset: number }[];
    pBuyMin: number;
    pBuyMax: number;
  };
  /** Bullish guard: E(t) = Pref·(1 + slope·(t − tref))·(1 − margin), pBuy raised below it. */
  envelope: { slopePerSec: number; margin: number; pBuyRecovery: number };
};

export const DEFAULT_FLOW_PARAMS: Readonly<FlowParams> = Object.freeze({
  newTraderProb: 0.6,
  wave: { amplitude: 0.35, periodSec: 45, floor: 0.2 },
  bursts: { meanIntervalSec: 40, amplitudeMin: 0.5, amplitudeMax: 1.5, decaySec: 6 },
  phases: {
    minSec: 10,
    maxSec: 30,
    // Rise, consolidation, small pullback: the weighted mean offset is zero.
    kinds: [
      { weight: 0.45, offset: 0.06 },
      { weight: 0.35, offset: -0.04 },
      { weight: 0.2, offset: -0.065 },
    ],
    pBuyMin: 0.35,
    pBuyMax: 0.85,
  },
  envelope: { slopePerSec: 0.002, margin: 0.05, pBuyRecovery: 0.85 },
});

export type Burst = { at: number; amplitude: number };
export type Phase = { start: number; end: number; offset: number };

/** The calendar of a run, drawn once at creation and independent of the trades. */
export interface Schedule {
  /** m(t) of §7.2: λ(t) = λ0 · m(t). */
  factorAt(tSec: number): number;
  /** pBuy of the phase containing t, clamped: the guard of the flow may raise it. */
  pBuyAt(tSec: number): number;
  readonly bursts: readonly Burst[];
  readonly phases: readonly Phase[];
}

function drawBursts(rng: Rng, durationSec: number, params: FlowParams["bursts"]): Burst[] {
  const bursts: Burst[] = [];
  let at = exponential(rng, 1 / params.meanIntervalSec);
  while (at <= durationSec) {
    bursts.push({ at, amplitude: uniform(rng, params.amplitudeMin, params.amplitudeMax) });
    at += exponential(rng, 1 / params.meanIntervalSec);
  }
  return bursts;
}

function drawPhases(rng: Rng, durationSec: number, params: FlowParams["phases"]): Phase[] {
  const phases: Phase[] = [];
  let start = 0;
  while (start < durationSec) {
    const length = uniform(rng, params.minSec, params.maxSec);
    const kind = pickWeighted(params.kinds, (k) => k.weight, rng.next());
    phases.push({ start, end: start + length, offset: kind?.offset ?? 0 });
    start += length;
  }
  return phases;
}

/**
 * Draws the calendar from its own stream: the phase of the wave, the bursts, the pBuy
 * phases. `pBuy` is the mean of the preset.
 */
export function createSchedule(
  rng: Rng,
  options: { durationSec: number; pBuy: number; params?: FlowParams },
): Schedule {
  const { durationSec, pBuy, params = DEFAULT_FLOW_PARAMS } = options;
  const wavePhase = TWO_PI * rng.next();
  const bursts = drawBursts(rng, durationSec, params.bursts);
  const phases = drawPhases(rng, durationSec, params.phases);
  const { wave, bursts: burstParams, phases: phaseParams } = params;

  return {
    bursts,
    phases,
    factorAt(t) {
      const waveValue = 1 + wave.amplitude * dmath.sin((TWO_PI * t) / wave.periodSec + wavePhase);
      let factor = Math.max(wave.floor, waveValue);
      for (const burst of bursts) {
        if (burst.at > t) break;
        factor += burst.amplitude * dmath.exp(-(t - burst.at) / burstParams.decaySec);
      }
      return factor;
    },
    pBuyAt(t) {
      // The last phase extends past durationSec.
      const phase = phases.find((p) => t < p.end) ?? phases[phases.length - 1];
      return clamp(pBuy + (phase?.offset ?? 0), phaseParams.pBuyMin, phaseParams.pBuyMax);
    },
  };
}
