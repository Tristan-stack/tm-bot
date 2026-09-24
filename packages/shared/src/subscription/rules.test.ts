import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS } from "../constants.js";
import type { Duration, Plan } from "../constants.js";
import { getOffer } from "./offers.js";
import { computeActivation, decidePurchase } from "./rules.js";
import type { SubscriptionPeriod } from "./rules.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const active = (
  plan: Plan,
  expiresAt: Date,
  duration: Duration = "ONE_MONTH",
): SubscriptionPeriod => ({
  plan,
  duration,
  startsAt: at(-10 * DAY_MS),
  expiresAt,
});

const CLASSIC_2D = getOffer("CLASSIC", "TWO_DAYS");
const CLASSIC_1M = getOffer("CLASSIC", "ONE_MONTH");
const PREMIUM_2D = getOffer("PREMIUM", "TWO_DAYS");
const PREMIUM_1M = getOffer("PREMIUM", "ONE_MONTH");

describe("decidePurchase (§8.4)", () => {
  it("starts a new plan without an active subscription", () => {
    expect(decidePurchase(null, "PREMIUM")).toBe("NEW");
  });

  it("extends the same plan, whatever the duration", () => {
    expect(decidePurchase(active("CLASSIC", at(DAY_MS), "TWO_DAYS"), "CLASSIC")).toBe("EXTEND");
  });

  it("moves from Classic to Premium, the Classic time being lost", () => {
    expect(decidePurchase(active("CLASSIC", at(DAY_MS)), "PREMIUM")).toBe("UPGRADE");
  });

  it("refuses Classic during Premium", () => {
    expect(decidePurchase(active("PREMIUM", at(DAY_MS)), "CLASSIC")).toBe("REFUSED");
  });
});

describe("computeActivation", () => {
  it("NEW 2 days: 172 800 000 ms from the activation", () => {
    expect(computeActivation(null, PREMIUM_2D, NOW, "PAYMENT")).toEqual({
      kind: "NEW",
      startsAt: NOW,
      expiresAt: at(172_800_000),
    });
  });

  it("NEW 1 month: 30 days from the activation", () => {
    expect(computeActivation(null, CLASSIC_1M, NOW, "GRANT")).toEqual({
      kind: "NEW",
      startsAt: NOW,
      expiresAt: at(30 * DAY_MS),
    });
  });

  it("EXTEND Premium 2 days + Premium 1 month: the current end + 30 days", () => {
    const current = active("PREMIUM", at(5 * HOUR_MS), "TWO_DAYS");

    expect(computeActivation(current, PREMIUM_1M, NOW, "PAYMENT")).toEqual({
      kind: "EXTEND",
      startsAt: current.startsAt,
      expiresAt: at(5 * HOUR_MS + 30 * DAY_MS),
    });
  });

  it("EXTEND Classic 1 month + Classic 2 days: the current end + 48 h", () => {
    const current = active("CLASSIC", at(20 * DAY_MS));

    expect(computeActivation(current, CLASSIC_2D, NOW, "GRANT")).toMatchObject({
      kind: "EXTEND",
      expiresAt: at(20 * DAY_MS + 48 * HOUR_MS),
    });
  });

  it("UPGRADE: Premium from now, the Classic time left is not added", () => {
    const current = active("CLASSIC", at(20 * DAY_MS));

    expect(computeActivation(current, PREMIUM_2D, NOW, "PAYMENT")).toEqual({
      kind: "UPGRADE",
      startsAt: NOW,
      expiresAt: at(48 * HOUR_MS),
    });
  });

  it("GRANT refuses Classic during Premium", () => {
    const current = active("PREMIUM", at(DAY_MS));

    expect(computeActivation(current, CLASSIC_1M, NOW, "GRANT")).toEqual({ kind: "REFUSED" });
  });

  it("PAYMENT extends the Premium by the Classic time instead (EXTEND_PREMIUM)", () => {
    const current = active("PREMIUM", at(DAY_MS));

    expect(computeActivation(current, CLASSIC_2D, NOW, "PAYMENT")).toEqual({
      kind: "EXTEND_PREMIUM",
      startsAt: current.startsAt,
      expiresAt: at(DAY_MS + 48 * HOUR_MS),
    });
  });

  it("treats an ACTIVE row whose end has passed as no subscription", () => {
    const ended = active("PREMIUM", NOW);

    expect(computeActivation(ended, CLASSIC_2D, NOW, "GRANT")).toEqual({
      kind: "NEW",
      startsAt: NOW,
      expiresAt: at(48 * HOUR_MS),
    });
  });
});
