import { describe, expect, it, vi } from "vitest";
import { createLastKnownValue } from "./last-known.js";
import type { LastKnownOptions } from "./last-known.js";

function harness(options: Partial<LastKnownOptions<number>> = {}) {
  let time = 1_000_000;
  const load = vi.fn<() => Promise<number>>().mockResolvedValue(1);
  const onFailure = vi.fn();
  const read = createLastKnownValue({ ttlMs: 1000, load, onFailure, now: () => time, ...options });
  return {
    read,
    load,
    onFailure,
    advance: (ms: number) => void (time += ms),
    down: () => load.mockRejectedValue(new Error("down")),
  };
}

describe("createLastKnownValue", () => {
  it("loads once per TTL, and says when the value was loaded", async () => {
    const { read, load, advance } = harness();

    expect(await read()).toEqual({ value: 1, loadedAt: 1_000_000, isFallback: false });
    advance(999);
    await read();
    expect(load).toHaveBeenCalledOnce();

    advance(1);
    await read();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent readers", async () => {
    const { read, load } = harness();

    await Promise.all(Array.from({ length: 10 }, read));

    expect(load).toHaveBeenCalledOnce();
  });

  it("returns null while the source has never answered, and reports each failed load once", async () => {
    const { read, onFailure, down } = harness();
    down();

    expect(await read()).toBeNull();
    expect(await read()).toBeNull();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it("does not ask a failing source again before its failure TTL", async () => {
    const { read, load, advance, down } = harness({ ttlMs: 10_000, failureTtlMs: 1000 });
    down();

    await read();
    advance(999);
    await read();
    expect(load).toHaveBeenCalledOnce();

    advance(1);
    await read();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("serves the last value as a fallback, however old by default", async () => {
    const { read, advance, down } = harness();
    await read();
    down();
    advance(1_000_000);

    expect(await read()).toEqual({ value: 1, loadedAt: 1_000_000, isFallback: true });
  });

  it("measures the age of the fallback on every read, with no new load", async () => {
    const { read, load, advance, down } = harness({ maxStaleMs: 5000 });
    await read();
    down();

    advance(4500);
    expect((await read())?.isFallback).toBe(true);
    // The failure is still cached, yet the last value is now too old.
    advance(600);
    expect(await read()).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("recovers as soon as the source answers again", async () => {
    const { read, load, advance, down } = harness();
    down();
    await read();

    load.mockResolvedValue(2);
    advance(1000);

    expect(await read()).toMatchObject({ value: 2, isFallback: false });
  });

  it("treats a load that throws like one that rejects", async () => {
    const { read } = harness({
      load: () => {
        throw new Error("sync");
      },
    });

    expect(await read()).toBeNull();
  });
});
