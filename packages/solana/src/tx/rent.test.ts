import { CACHE_TTL_MS } from "@launchbot/shared";
import { describe, expect, it } from "vitest";
import { getRentExemptMinimum } from "./rent.js";
import { DEVNET_RENT_MIN, fakeRpc } from "./test-rpc.js";

describe("getRentExemptMinimum", () => {
  it("reads the minimum of an empty account, in lamports", async () => {
    const { rpc, calls } = fakeRpc();

    expect(await getRentExemptMinimum(rpc)).toBe(DEVNET_RENT_MIN);
    expect(calls).toEqual([{ method: "getMinimumBalanceForRentExemption", size: 0 }]);
  });

  it("keeps it for the TTL of the cache, then reads it again", async () => {
    let now = 0;
    const { rpc, of, state } = fakeRpc();
    const read = () => getRentExemptMinimum(rpc, () => now);

    await read();
    now = CACHE_TTL_MS.rentMin - 1;
    await read();
    expect(of("getMinimumBalanceForRentExemption")).toHaveLength(1);

    now = CACHE_TTL_MS.rentMin;
    state.rentMin = 1_000_000;
    expect(await read()).toBe(1_000_000n);
    expect(of("getMinimumBalanceForRentExemption")).toHaveLength(2);
  });

  it("refuses the 0 web3.js answers to an RPC error, and asks again next time", async () => {
    const { rpc, of, state } = fakeRpc({ rentMin: 0 });

    await expect(getRentExemptMinimum(rpc)).rejects.toThrow("no rent-exempt minimum");
    state.rentMin = Number(DEVNET_RENT_MIN);
    expect(await getRentExemptMinimum(rpc)).toBe(DEVNET_RENT_MIN);
    expect(of("getMinimumBalanceForRentExemption")).toHaveLength(2);
  });

  it("gives each connection its own cache", async () => {
    const first = fakeRpc();
    const second = fakeRpc({ rentMin: 1_000_000 });

    expect(await getRentExemptMinimum(first.rpc)).toBe(DEVNET_RENT_MIN);
    expect(await getRentExemptMinimum(second.rpc)).toBe(1_000_000n);
  });
});
