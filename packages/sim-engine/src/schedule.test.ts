import { describe, expect, it } from "vitest";
import { createRng } from "./rng.js";
import { createSchedule, DEFAULT_FLOW_PARAMS } from "./schedule.js";
import type { Schedule } from "./schedule.js";

const DURATION = 180;
const schedule = (seed: number, pBuy = 0.56): Schedule =>
  createSchedule(createRng(seed), { durationSec: DURATION, pBuy });

describe("createSchedule", () => {
  it("keeps m(t) at or above the floor everywhere", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const s = schedule(seed);
      for (let t = 0; t <= DURATION; t += 0.5) {
        expect(s.factorAt(t)).toBeGreaterThanOrEqual(DEFAULT_FLOW_PARAMS.wave.floor);
      }
    }
  });

  it("adds a burst that decays over about six seconds", () => {
    const s = schedule(3);
    const burst = s.bursts[0];
    expect(burst).toBeDefined();
    if (burst === undefined) return;
    const justBefore = s.factorAt(burst.at - 1e-6);
    const atBurst = s.factorAt(burst.at);
    expect(atBurst - justBefore).toBeCloseTo(burst.amplitude, 3);
    expect(s.factorAt(burst.at + 6 * 5)).toBeLessThan(atBurst);
  });

  it("chains pBuy phases of 10 to 30 s over the whole duration", () => {
    const s = schedule(5);
    expect(s.phases[0]?.start).toBe(0);
    let expectedStart = 0;
    for (const phase of s.phases) {
      expect(phase.start).toBe(expectedStart);
      expect(phase.end - phase.start).toBeGreaterThanOrEqual(10);
      expect(phase.end - phase.start).toBeLessThanOrEqual(30);
      expect([0.06, -0.04, -0.065]).toContain(phase.offset);
      expectedStart = phase.end;
    }
    expect(expectedStart).toBeGreaterThanOrEqual(DURATION);
  });

  it("gives the 3 SOL preset a pBuy of 0.62, 0.52 or 0.495 by phase, clamped to [0.35, 0.85]", () => {
    const s = schedule(8);
    for (const phase of s.phases) {
      const pBuy = s.pBuyAt((phase.start + phase.end) / 2);
      expect([0.62, 0.52, 0.495].some((v) => Math.abs(v - pBuy) < 1e-12)).toBe(true);
    }
    expect(s.pBuyAt(DURATION + 100)).toBe(s.pBuyAt(DURATION - 1e-9));
    expect(schedule(8, 0.84).pBuyAt(0)).toBeLessThanOrEqual(0.85);
    expect(schedule(8, 0.36).pBuyAt(0)).toBeGreaterThanOrEqual(0.35);
  });

  it("has a time-weighted mean phase offset of 0 ± 0.01 over 1 000 seeds", () => {
    let weighted = 0;
    let time = 0;
    for (let seed = 1; seed <= 1_000; seed += 1) {
      for (const phase of schedule(seed).phases) {
        const end = phase.end < DURATION ? phase.end : DURATION;
        weighted += phase.offset * (end - phase.start);
        time += end - phase.start;
      }
    }
    expect(Math.abs(weighted / time)).toBeLessThanOrEqual(0.01);
  });

  it("draws the same calendar from the same seed", () => {
    const a = schedule(11);
    const b = schedule(11);
    expect(a.bursts).toEqual(b.bursts);
    expect(a.phases).toEqual(b.phases);
    for (let t = 0; t <= DURATION; t += 7) expect(a.factorAt(t)).toBe(b.factorAt(t));
    expect(schedule(12).phases).not.toEqual(a.phases);
  });
});
