import { CACHE_TTL_MS, createTtlCache, PER_USER_CACHE_MAX_ENTRIES } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { PrismaClient } from "../generated/prisma/client.js";

const log = createLogger("db:balances");

export type WalletBalance = {
  id: string;
  name: string;
  publicKey: string;
  /** `null` when the balances are `unavailable`. */
  lamports: bigint | null;
};

export type UserBalances = {
  /** Oldest wallet first. The rows come from the database: they are there whatever the RPC does. */
  wallets: WalletBalance[];
  totalLamports: bigint | null;
  fetchedAt: Date;
  /**
   * - `fresh`: read from the RPC, or from the cache of 30 s.
   * - `stale`: the RPC failed, these are the last balances read, however old (proposal).
   * - `unavailable`: the RPC failed and no balance of these wallets was ever read.
   */
  status: "fresh" | "stale" | "unavailable";
};

export type BalancesDeps = {
  prisma: PrismaClient;
  /** `getBalancesFresh` of @launchbot/solana: this package does not depend on it. */
  readLamports: (addresses: string[]) => Promise<Map<string, bigint>>;
  now?: () => number;
};

export type BalancesService = {
  /**
   * What screens show: cached 30 s per user (§4.3). It never throws for an RPC failure, so a
   * screen always has its wallets. `skipCache` is a Refresh button (§4.4): the caller decides
   * whether the user may have one. A decision about money reads `getBalancesFresh` instead.
   */
  getUserBalances: (userId: string, options?: { skipCache?: boolean }) => Promise<UserBalances>;
  /** After a withdrawal (V1-14) or a payment from a wallet (V1-31). */
  invalidateUserBalances: (userId: string) => void;
};

const addressesOf = (wallets: { publicKey: string }[]) => wallets.map((wallet) => wallet.publicKey);

export function createBalancesService(deps: BalancesDeps): BalancesService {
  const { prisma, readLamports, now = Date.now } = deps;
  const cache = createTtlCache<string, UserBalances>({
    ttlMs: CACHE_TTL_MS.balances,
    maxEntries: PER_USER_CACHE_MAX_ENTRIES,
    now,
  });

  return {
    invalidateUserBalances: (userId) => cache.delete(userId),

    async getUserBalances(userId, { skipCache = false } = {}) {
      const wallets = await prisma.wallet.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, publicKey: true },
      });
      const fetchedAt = new Date(now());
      if (wallets.length === 0) {
        return { wallets: [], totalLamports: 0n, fetchedAt, status: "fresh" };
      }

      // A wallet created, imported or deleted: what is cached is about other wallets.
      const addresses = addressesOf(wallets);
      const cached = cache.peek(userId)?.value;
      if (cached !== undefined && addressesOf(cached.wallets).join() !== addresses.join()) {
        cache.delete(userId);
      }

      const load = async (): Promise<UserBalances> => {
        const lamports = await readLamports(addresses);
        const balances = wallets.map((wallet) => ({
          ...wallet,
          lamports: lamports.get(wallet.publicKey) ?? 0n,
        }));
        return {
          wallets: balances,
          totalLamports: balances.reduce((total, wallet) => total + wallet.lamports, 0n),
          fetchedAt,
          status: "fresh",
        };
      };

      try {
        if (!skipCache) return await cache.get(userId, load);
        const fresh = await load();
        cache.set(userId, fresh);
        return fresh;
      } catch (error) {
        // Names are not logged: a wallet name is a user input.
        log.warn({ err: error, wallets: wallets.length }, "Balance read failed");
        const last = cache.peek(userId)?.value;
        if (last !== undefined) return { ...last, status: "stale" };
        return {
          wallets: wallets.map((wallet) => ({ ...wallet, lamports: null })),
          totalLamports: null,
          fetchedAt,
          status: "unavailable",
        };
      }
    },
  };
}
