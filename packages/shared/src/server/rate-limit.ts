import { MINUTE_MS, RATE_LIMITS } from "../constants.js";

export type RateLimitedAction = keyof typeof RATE_LIMITS;
export type RateLimitVerdict = { ok: true } | { ok: false; retryAfterMs: number };

type Window = { windowMs: number; stamps: number[] };

/**
 * Sliding windows, in the memory of the process (D17): counters reset on restart. The bot and
 * the API share this module, so a user cannot spend the same quota twice (V1-23).
 */
const windows = new Map<string, Window>();
let lastSweep = 0;

/** Forgets the users who stopped: without it the map grows with every account ever seen. */
function sweep(now: number): void {
  if (now - lastSweep < MINUTE_MS) return;
  lastSweep = now;
  for (const [key, { windowMs, stamps }] of windows) {
    if ((stamps.at(-1) ?? 0) <= now - windowMs) windows.delete(key);
  }
}

/** Records one attempt and says whether it is allowed. The caller writes the block on screen. */
export function consumeRateLimit(
  userId: number,
  action: RateLimitedAction,
  now: number = Date.now(),
): RateLimitVerdict {
  sweep(now);
  const { limit, windowMs } = RATE_LIMITS[action];
  const key = `${action}:${userId}`;
  const stamps = (windows.get(key)?.stamps ?? []).filter((at) => at > now - windowMs);
  windows.set(key, { windowMs, stamps });

  // A refused attempt takes no slot: the oldest hit of the window is the one that must expire.
  if (stamps.length >= limit)
    return { ok: false, retryAfterMs: (stamps[0] ?? now) + windowMs - now };
  stamps.push(now);
  return { ok: true };
}

/** Test seam: forgets every counter. */
export function resetRateLimits(): void {
  windows.clear();
  lastSweep = 0;
}
