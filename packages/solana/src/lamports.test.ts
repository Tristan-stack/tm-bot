import { Keypair } from "@solana/web3.js";
import type { Commitment, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { getBalancesFresh } from "./lamports.js";
import type { BalancesReader } from "./lamports.js";
import { getSolanaRpc } from "./rpc.js";

const addresses = (count: number) =>
  Array.from({ length: count }, () => Keypair.generate().publicKey.toBase58());

/** Every account holds its index in lamports, except the ones listed as missing. */
function fakeRpc(missing = new Set<string>()) {
  let next = 0;
  const getMultipleAccountsInfo = vi.fn<
    (keys: PublicKey[], commitment?: Commitment) => Promise<({ lamports: number } | null)[]>
  >((keys) =>
    Promise.resolve(
      keys.map((key) => (missing.has(key.toBase58()) ? null : { lamports: next++ * 1000 })),
    ),
  );
  return { getMultipleAccountsInfo } as unknown as BalancesReader & {
    getMultipleAccountsInfo: typeof getMultipleAccountsInfo;
  };
}

describe("getBalancesFresh", () => {
  it("reads every address in one call, in lamports as bigint", async () => {
    const rpc = fakeRpc();
    const [a, b, c] = addresses(3) as [string, string, string];

    const balances = await getBalancesFresh(rpc, [a, b, c], "finalized");

    expect(rpc.getMultipleAccountsInfo).toHaveBeenCalledOnce();
    expect(rpc.getMultipleAccountsInfo.mock.calls[0]?.[1]).toBe("finalized");
    expect([...balances]).toEqual([
      [a, 0n],
      [b, 1000n],
      [c, 2000n],
    ]);
  });

  it("counts an address that never received anything as 0 lamport", async () => {
    const [funded, empty] = addresses(2) as [string, string];

    const balances = await getBalancesFresh(fakeRpc(new Set([empty])), [funded, empty]);

    expect(balances.get(empty)).toBe(0n);
  });

  it("splits the read in calls of 100 accounts", async () => {
    const rpc = fakeRpc();
    const many = addresses(201);

    const balances = await getBalancesFresh(rpc, many);

    expect(rpc.getMultipleAccountsInfo.mock.calls.map(([keys]) => keys.length)).toEqual([
      100, 100, 1,
    ]);
    expect(balances.size).toBe(201);
  });

  it("makes no call for no address", async () => {
    const rpc = fakeRpc();

    expect((await getBalancesFresh(rpc, [])).size).toBe(0);
    expect(rpc.getMultipleAccountsInfo).not.toHaveBeenCalled();
  });
});

describe("getSolanaRpc", () => {
  it("keeps one confirmed connection per URL", () => {
    const first = getSolanaRpc("https://api.devnet.solana.com");

    expect(getSolanaRpc("https://api.devnet.solana.com")).toBe(first);
    expect(first.commitment).toBe("confirmed");
    expect(getSolanaRpc("https://rpc.example.com")).not.toBe(first);
  });
});

// Needs the network: RUN_DEVNET_TESTS=1.
describe.skipIf(!process.env["RUN_DEVNET_TESTS"])("getBalancesFresh (devnet)", () => {
  it("reads a real balance from devnet", async () => {
    // The clock sysvar: an account that exists on every cluster and is always rent exempt.
    const address = "SysvarC1ock11111111111111111111111111111111";

    const balances = await getBalancesFresh(getSolanaRpc("https://api.devnet.solana.com"), [
      address,
    ]);

    expect(balances.get(address)).toBeGreaterThan(0n);
  }, 30_000);
});
