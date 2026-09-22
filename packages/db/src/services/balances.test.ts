import { SECOND_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createBalancesService } from "./balances.js";

type WalletRow = { id: string; name: string; publicKey: string };

const wallet = (id: string): WalletRow => ({ id, name: `Wallet ${id}`, publicKey: `pk-${id}` });
const T0 = Date.parse("2026-09-21T12:00:00Z");

function harness(initial: WalletRow[]) {
  let time = T0;
  let rows = initial;
  const findMany = vi.fn(() => Promise.resolve(rows));
  const readLamports = vi.fn((addresses: string[]) =>
    // pk-a holds 1 SOL, pk-b 2 SOL; pk-c has no account, so the reader reports nothing for it.
    Promise.resolve(
      new Map(
        addresses.flatMap((address): [string, bigint][] =>
          address === "pk-c"
            ? []
            : [[address, address === "pk-a" ? 1_000_000_000n : 2_000_000_000n]],
        ),
      ),
    ),
  );
  const service = createBalancesService({
    prisma: { wallet: { findMany } } as unknown as PrismaClient,
    readLamports,
    now: () => time,
  });
  return {
    ...service,
    findMany,
    readLamports,
    advance: (ms: number) => void (time += ms),
    setWallets: (next: WalletRow[]) => void (rows = next),
  };
}

afterEach(() => {
  setLogDestination(undefined);
});

describe("getUserBalances", () => {
  it("reads the wallets of the user, oldest first, in one RPC call", async () => {
    const { getUserBalances, findMany, readLamports } = harness([
      wallet("a"),
      wallet("b"),
      wallet("c"),
    ]);

    const balances = await getUserBalances("u1");

    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, publicKey: true },
    });
    expect(readLamports).toHaveBeenCalledExactlyOnceWith(["pk-a", "pk-b", "pk-c"]);
    expect(balances).toEqual({
      wallets: [
        { ...wallet("a"), lamports: 1_000_000_000n },
        { ...wallet("b"), lamports: 2_000_000_000n },
        // No account on chain: 0 SOL, not an error.
        { ...wallet("c"), lamports: 0n },
      ],
      totalLamports: 3_000_000_000n,
      fetchedAt: new Date(T0),
      status: "fresh",
    });
  });

  it("makes no RPC call for a user without a wallet", async () => {
    const { getUserBalances, readLamports } = harness([]);

    expect(await getUserBalances("u1")).toEqual({
      wallets: [],
      totalLamports: 0n,
      fetchedAt: new Date(T0),
      status: "fresh",
    });
    expect(readLamports).not.toHaveBeenCalled();
  });

  it("serves the cache for 30 s, per user", async () => {
    const { getUserBalances, readLamports, advance } = harness([wallet("a")]);

    await getUserBalances("u1");
    advance(29 * SECOND_MS);
    await getUserBalances("u1");
    expect(readLamports).toHaveBeenCalledOnce();

    await getUserBalances("u2");
    advance(SECOND_MS);
    await getUserBalances("u1");
    expect(readLamports).toHaveBeenCalledTimes(3);
  });

  it("ignores the cache as soon as the wallets of the user change", async () => {
    const { getUserBalances, readLamports, setWallets } = harness([wallet("a")]);
    await getUserBalances("u1");

    setWallets([wallet("a"), wallet("b")]);
    const balances = await getUserBalances("u1");

    expect(readLamports).toHaveBeenCalledTimes(2);
    expect(balances.wallets).toHaveLength(2);
  });

  it("reads again after an invalidation", async () => {
    const { getUserBalances, invalidateUserBalances, readLamports } = harness([wallet("a")]);
    await getUserBalances("u1");

    invalidateUserBalances("u1");
    await getUserBalances("u1");

    expect(readLamports).toHaveBeenCalledTimes(2);
  });

  it("serves the last balances as stale when the RPC fails", async () => {
    const lines = captureLogs();
    const { getUserBalances, readLamports, advance } = harness([wallet("a")]);
    await getUserBalances("u1");
    advance(5 * 60 * SECOND_MS);
    readLamports.mockRejectedValueOnce(new Error("RPC down"));

    const balances = await getUserBalances("u1");

    expect(balances).toMatchObject({
      status: "stale",
      totalLamports: 1_000_000_000n,
      fetchedAt: new Date(T0),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("Wallet a");
  });

  it("still returns the wallets, without balances, when nothing was ever read", async () => {
    captureLogs();
    const { getUserBalances, readLamports } = harness([wallet("a"), wallet("b")]);
    readLamports.mockRejectedValueOnce(new Error("RPC down"));

    expect(await getUserBalances("u1")).toEqual({
      wallets: [
        { ...wallet("a"), lamports: null },
        { ...wallet("b"), lamports: null },
      ],
      totalLamports: null,
      fetchedAt: new Date(T0),
      status: "unavailable",
    });
  });

  it("does not serve balances of other wallets as stale", async () => {
    captureLogs();
    const { getUserBalances, readLamports, setWallets } = harness([wallet("a")]);
    await getUserBalances("u1");
    setWallets([wallet("b")]);
    readLamports.mockRejectedValueOnce(new Error("RPC down"));

    expect((await getUserBalances("u1")).status).toBe("unavailable");
  });
});

describe("getUserBalances with skipCache", () => {
  it("skips the cache, and rewrites it", async () => {
    const { getUserBalances, readLamports } = harness([wallet("a")]);
    await getUserBalances("u1");

    await getUserBalances("u1", { skipCache: true });
    await getUserBalances("u1");

    expect(readLamports).toHaveBeenCalledTimes(2);
  });

  it("serves the last balances as stale when the forced read fails", async () => {
    captureLogs();
    const { getUserBalances, readLamports } = harness([wallet("a")]);
    await getUserBalances("u1");
    readLamports.mockRejectedValueOnce(new Error("RPC down"));

    expect((await getUserBalances("u1", { skipCache: true })).status).toBe("stale");
  });
});
