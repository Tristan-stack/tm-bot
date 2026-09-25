import { describe, expect, it } from "vitest";
import { HOUR_MS, INACTIVITY_DELETE_MS, MINUTE_MS } from "./constants.js";
import { inactivityCutoff, isInactiveCandidate } from "./inactivity.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const idleFor = (ms: number) => ({ telegramId: 42n, lastActiveAt: new Date(NOW.getTime() - ms) });

describe("isInactiveCandidate (decision of 16/09/2026, V1-45)", () => {
  it("deletes after 24 h without activity, not before", () => {
    expect(
      isInactiveCandidate(idleFor(INACTIVITY_DELETE_MS - MINUTE_MS), { now: NOW, adminIds: [] }),
    ).toBe(false);
    expect(
      isInactiveCandidate(idleFor(INACTIVITY_DELETE_MS + MINUTE_MS), { now: NOW, adminIds: [] }),
    ).toBe(true);
    expect(
      isInactiveCandidate(idleFor(23 * HOUR_MS + 59 * MINUTE_MS), { now: NOW, adminIds: [] }),
    ).toBe(false);
  });

  it("never an admin; an empty list exempts nobody", () => {
    const idle = idleFor(72 * HOUR_MS);
    expect(isInactiveCandidate(idle, { now: NOW, adminIds: [7, 42] })).toBe(false);
    expect(isInactiveCandidate(idle, { now: NOW, adminIds: [7] })).toBe(true);
  });

  it("gives the cutoff of a pass", () => {
    expect(inactivityCutoff(NOW)).toEqual(new Date("2026-09-23T12:00:00Z"));
  });
});
