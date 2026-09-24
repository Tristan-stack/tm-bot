import {
  CACHE_TTL_MS,
  chunk,
  createTtlCache,
  MAX_ACCOUNTS_PER_READ,
  PER_USER_CACHE_MAX_ENTRIES,
} from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { PrismaClient } from "../generated/prisma/client.js";

const log = createLogger("db:balances");

/** The columns of a wallet the screens show: never a key column (§9.6). */
export const WALLET_SUMMARY_SELECT = {
  id: true,
  name: true,
  publicKey: true,
  createdAt: true,
} as const;

export type WalletBalance = {
  id: string;
  name: string;
  publicKey: string;
  createdAt: Date;
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

/** The detail screen (§9.2): one wallet, with when and how well its balance was read. */
export type WalletDetailData = Pick<UserBalances, "fetchedAt" | "status"> & {
  wallet: WalletBalance;
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
        select: WALLET_SUMMARY_SELECT,
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

/** A wallet of the user with its balance read this very moment, or why it cannot be used. */
export type FreshWalletRead =
  | { status: "not_found" }
  | { status: "balance_unavailable"; detail: WalletDetailData }
  | { status: "fresh"; detail: WalletDetailData; lamports: bigint };

/**
 * What a decision about money starts from (Delete of V1-11, a withdrawal of V1-14): the rows
 * come with the balances, so an id of another user is simply not there, and a stale balance is
 * not a check — money moves on a read of this very moment only. Not the Refresh: no throttle.
 */
export async function readFreshWallet(
  balances: Pick<BalancesService, "getUserBalances">,
  userId: string,
  walletId: string,
): Promise<FreshWalletRead> {
  const read = await balances.getUserBalances(userId, { skipCache: true });
  const wallet = read.wallets.find((candidate) => candidate.id === walletId);
  if (wallet === undefined) return { status: "not_found" };
  const detail = { wallet, fetchedAt: read.fetchedAt, status: read.status };
  if (read.status !== "fresh" || wallet.lamports === null) {
    return { status: "balance_unavailable", detail };
  }
  return { status: "fresh", detail, lamports: wallet.lamports };
}

/**
 * Balances by groups of 100 addresses, one `getMultipleAccountsInfo` each: a group the RPC
 * refuses is left out, logged, and the others are still read. Every address of a group read is
 * in the map (0 when it holds nothing), so a missing one means « not read » — nothing is decided
 * on it. The payment loop (V1-32) and the treasury (V1-33) read their deposits this way.
 */
export async function readBalancesInGroups(
  read: (addresses: readonly string[]) => Promise<Map<string, bigint>>,
  addresses: readonly string[],
): Promise<Map<string, bigint>> {
  const balances = new Map<string, bigint>();
  for (const group of chunk(addresses, MAX_ACCOUNTS_PER_READ)) {
    try {
      const lamports = await read(group);
      for (const address of group) balances.set(address, lamports.get(address) ?? 0n);
    } catch (error) {
      log.warn({ err: error, addresses: group.length }, "balances.group_read_failed");
    }
  }
  return balances;
}
