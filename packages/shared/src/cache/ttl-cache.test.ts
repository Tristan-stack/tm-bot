import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttl-cache.js";

function harness(options: { ttlMs?: number; maxEntries?: number } = {}) {
  let time = 1_000_000;
  const cache = createTtlCache<string, number>({ ttlMs: 1000, ...options, now: () => time });
  return { cache, advance: (ms: number) => void (time += ms), time: () => time };
}

describe("createTtlCache", () => {
  it("serves the cached value until it is as old as the TTL", async () => {
    const { cache, advance } = harness();
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.get("k", loader)).toBe(1);
    advance(999);
    expect(await cache.get("k", loader)).toBe(1);
    advance(1);
    expect(await cache.get("k", loader)).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("shares one load between concurrent calls for the same key", async () => {
    const { cache } = harness();
    let release: (value: number) => void = () => undefined;
    const loader = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));

    const reads = Array.from({ length: 10 }, () => cache.get("k", loader));
    await Promise.resolve();
    release(7);

    expect(await Promise.all(reads)).toEqual(Array(10).fill(7));
    expect(loader).toHaveBeenCalledOnce();
  });

  it("loads each key on its own", async () => {
    const { cache } = harness();

    expect(await cache.get("a", () => Promise.resolve(1))).toBe(1);
    expect(await cache.get("b", () => Promise.resolve(2))).toBe(2);
  });

  it("does not cache a rejected load, rejects everyone waiting, and loads again next time", async () => {
    const { cache } = harness();
    const loader = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(3);

    const waiting = [cache.get("k", loader), cache.get("k", loader)];

    await expect(waiting[0]).rejects.toThrow("down");
    await expect(waiting[1]).rejects.toThrow("down");
    expect(cache.peek("k")).toBeUndefined();
    expect(await cache.get("k", loader)).toBe(3);
  });

  it("rejects, rather than throws, when the loader throws", async () => {
    const { cache } = harness();

    await expect(
      cache.get("k", () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
  });

  it("peeks at an expired value, which a failed reload leaves in place", async () => {
    const { cache, advance, time } = harness();
    await cache.get("k", () => Promise.resolve(1));
    const storedAt = time();
    advance(5000);

    await expect(cache.get("k", () => Promise.reject(new Error("down")))).rejects.toThrow();

    expect(cache.peek("k")).toEqual({ value: 1, storedAt });
  });

  it("sets, deletes and clears", async () => {
    const { cache } = harness();
    const loader = vi.fn().mockResolvedValue(9);

    cache.set("k", 1);
    expect(await cache.get("k", loader)).toBe(1);
    cache.delete("k");
    expect(await cache.get("k", loader)).toBe(9);
    cache.clear();
    expect(cache.peek("k")).toBeUndefined();
  });

  it("evicts the oldest entry past maxEntries, a rewritten key counting as new", () => {
    const { cache } = harness({ maxEntries: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 3);
    cache.set("c", 4);

    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("a")?.value).toBe(3);
    expect(cache.peek("c")?.value).toBe(4);
  });
});
