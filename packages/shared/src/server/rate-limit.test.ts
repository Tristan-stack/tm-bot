import { beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMITS } from "../constants.js";
import { consumeRateLimit, resetRateLimits } from "./rate-limit.js";

beforeEach(resetRateLimits);

describe("consumeRateLimit", () => {
  it("allows the configured number of attempts, then blocks", () => {
    const { limit } = RATE_LIMITS.withdrawal;

    for (let attempt = 0; attempt < limit; attempt++) {
      expect(consumeRateLimit(1, "withdrawal", 1000).ok).toBe(true);
    }
    expect(consumeRateLimit(1, "withdrawal", 1000)).toEqual({
      ok: false,
      retryAfterMs: RATE_LIMITS.withdrawal.windowMs,
    });
  });

  it("slides the window: the oldest attempt is the one that frees a slot", () => {
    const { windowMs } = RATE_LIMITS.paymentCheck; // 1 per 5 s

    expect(consumeRateLimit(2, "paymentCheck", 0).ok).toBe(true);
    expect(consumeRateLimit(2, "paymentCheck", 2000)).toEqual({ ok: false, retryAfterMs: 3000 });
    expect(consumeRateLimit(2, "paymentCheck", windowMs).ok).toBe(true);
  });

  it("counts each user and each action apart", () => {
    expect(consumeRateLimit(10, "paymentCheck", 0).ok).toBe(true);
    expect(consumeRateLimit(10, "paymentCheck", 0).ok).toBe(false);
    // Another user, and another action of the same user, are untouched.
    expect(consumeRateLimit(11, "paymentCheck", 0).ok).toBe(true);
    expect(consumeRateLimit(10, "invoice", 0).ok).toBe(true);
  });

  it("does not consume a slot when it blocks", () => {
    consumeRateLimit(3, "paymentCheck", 0);
    consumeRateLimit(3, "paymentCheck", 1000);
    consumeRateLimit(3, "paymentCheck", 2000);

    // The first attempt still expires 5 s after it was made, not after the refused ones.
    expect(consumeRateLimit(3, "paymentCheck", 5000).ok).toBe(true);
  });

  it("uses the current clock by default", () => {
    expect(consumeRateLimit(4, "simulation").ok).toBe(true);
  });
});
