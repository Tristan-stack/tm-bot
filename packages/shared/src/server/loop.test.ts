import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureLogs, setLogDestination } from "./logger.js";
import { runEvery } from "./loop.js";

const INTERVAL = 15_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setLogDestination(undefined);
});

/** Stops the loop while its tick in progress runs out on the fake clock. */
async function stopDuring(loop: { stop: () => Promise<void> }): Promise<void> {
  const stopped = loop.stop();
  await vi.advanceTimersByTimeAsync(INTERVAL);
  await stopped;
}

/** A tick that lasts `ms` of the fake clock, counting how many run at once. */
function timedTicks(durations: number[]) {
  const starts: number[] = [];
  let running = 0;
  let overlap = 0;
  const run = vi.fn(async () => {
    starts.push(Date.now());
    running += 1;
    overlap = Math.max(overlap, running);
    await new Promise((resolve) => setTimeout(resolve, durations[starts.length - 1] ?? 0));
    running -= 1;
  });
  return { run, starts, overlap: () => overlap };
}

describe("runEvery (V1-32)", () => {
  it("runs at once, then every interval from the start of the previous tick", async () => {
    const ticks = timedTicks([1_000, 1_000, 1_000]);
    const loop = runEvery({ name: "payments", intervalMs: INTERVAL, run: ticks.run });

    await vi.advanceTimersByTimeAsync(2 * INTERVAL + 500);
    await stopDuring(loop);

    const [first = 0, ...rest] = ticks.starts;
    expect(rest.map((start) => start - first)).toEqual([INTERVAL, 2 * INTERVAL]);
  });

  it("never runs two ticks at once, and follows a slow tick at once with a warning", async () => {
    const lines = captureLogs();
    const ticks = timedTicks([20_000, 1_000]);
    const loop = runEvery({ name: "payments", intervalMs: INTERVAL, run: ticks.run });

    await vi.advanceTimersByTimeAsync(20_500);
    await stopDuring(loop);

    expect(ticks.starts).toHaveLength(2);
    // At once: Node clamps a timeout of 0 to 1 ms.
    const gap = (ticks.starts[1] ?? 0) - (ticks.starts[0] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(20_000);
    expect(gap).toBeLessThanOrEqual(20_001);
    expect(ticks.overlap()).toBe(1);
    expect(lines.join("")).toContain("loop.tick_slow");
  });

  it("keeps going after a tick that fails", async () => {
    captureLogs();
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("RPC down"))
      .mockResolvedValue(undefined);
    const loop = runEvery({ name: "payments", intervalMs: INTERVAL, run });

    await vi.advanceTimersByTimeAsync(INTERVAL);
    await loop.stop();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stop waits for the tick in progress and starts no other", async () => {
    let finished = false;
    const run = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      finished = true;
    });
    const loop = runEvery({ name: "payments", intervalMs: INTERVAL, run });

    const stopped = loop.stop();
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    await stopped;
    expect(finished).toBe(true);

    await vi.advanceTimersByTimeAsync(10 * INTERVAL);
    expect(run).toHaveBeenCalledOnce();
  });
});
