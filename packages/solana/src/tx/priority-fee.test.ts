import { describe, expect, it } from "vitest";
import { RpcUnavailableError } from "../rpc.js";
import { estimatePriorityFee, medianMicroLamports } from "./priority-fee.js";
import { address, fakeRpc, TEST_BOUNDS } from "./test-rpc.js";

describe("medianMicroLamports", () => {
  it("has no median for no fee at all", () => {
    expect(medianMicroLamports([])).toBeUndefined();
  });

  it("keeps the zeros: a cluster that asks for nothing asks for nothing", () => {
    expect(medianMicroLamports([0, 0, 0])).toBe(0n);
    expect(medianMicroLamports([0, 0, 10, 10])).toBe(5n);
  });

  it("sorts before it takes the middle", () => {
    expect(medianMicroLamports([5, 1, 3])).toBe(3n);
  });

  it("rounds the mean of the two middle values up", () => {
    expect(medianMicroLamports([1, 2, 3, 4])).toBe(3n);
    expect(medianMicroLamports([1, 1, 4, 4])).toBe(3n);
  });
});

describe("estimatePriorityFee", () => {
  it("asks for the accounts the transaction writes, deduplicated and capped at 128", async () => {
    const many = Array.from({ length: 200 }, address);
    const { rpc, calls } = fakeRpc({ fees: [7] });

    await estimatePriorityFee(rpc, [...many, ...many], TEST_BOUNDS);

    const accounts = calls[0]?.["accounts"];
    expect(Array.isArray(accounts) && accounts.length).toBe(128);
    expect(new Set(accounts as string[]).size).toBe(128);
  });

  it("takes the median of the recent slots", async () => {
    const { rpc } = fakeRpc({ fees: [5, 1, 3] });

    expect(await estimatePriorityFee(rpc, [address()], TEST_BOUNDS)).toBe(3n);
  });

  it("falls back to the minimum when no slot paid a priority fee", async () => {
    const { rpc } = fakeRpc({ fees: [] });

    expect(
      await estimatePriorityFee(rpc, [address()], { ...TEST_BOUNDS, minMicroLamports: 500 }),
    ).toBe(500n);
  });

  it("stays inside the bounds of the configuration", async () => {
    const low = fakeRpc({ fees: [10] });
    const high = fakeRpc({ fees: [2_000_000] });

    expect(
      await estimatePriorityFee(low.rpc, [address()], { ...TEST_BOUNDS, minMicroLamports: 500 }),
    ).toBe(500n);
    expect(await estimatePriorityFee(high.rpc, [address()], TEST_BOUNDS)).toBe(1_000_000n);
  });

  it("uses the minimum when the RPC cannot answer: a transaction still goes out", async () => {
    const { rpc } = fakeRpc({
      fees: [5000],
      throws: { getRecentPrioritizationFees: new RpcUnavailableError("The RPC answered 503") },
    });

    expect(
      await estimatePriorityFee(rpc, [address()], { ...TEST_BOUNDS, minMicroLamports: 100 }),
    ).toBe(100n);
  });
});
