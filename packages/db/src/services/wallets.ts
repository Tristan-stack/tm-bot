import {
  getWalletLimit,
  isBalanceWithdrawable,
  normalizeWalletName,
  walletNameIssue,
} from "@launchbot/shared";
import type { WalletNameIssue } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { KeyVault, MnemonicWallet } from "@launchbot/solana";
import type { Db } from "../client.js";
import { isUniqueViolation } from "../errors.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { WALLET_SUMMARY_SELECT } from "./balances.js";
import type { BalancesService, UserBalances, WalletBalance } from "./balances.js";
import { getActiveSubscription, getWalletQuota } from "./subscriptions.js";

const log = createLogger("db:wallets");

/** A wallet as the screens show it: never a key column (§9.6). */
export type WalletSummary = Omit<WalletBalance, "lamports">;

/** The list screen (§9.1): the balances of V1-07 and the quota of the plan (§8.1). */
export type WalletListData = UserBalances & {
  count: number;
  /** `count` can exceed it: wallets are kept after an expiry or a downgrade (§8.1). */
  limit: number;
};

export type WalletDetailData = Pick<UserBalances, "fetchedAt" | "status"> & {
  wallet: WalletBalance;
};

export type CreateWalletResult =
  { ok: true; wallet: WalletSummary } | { ok: false; reason: "limit_reached" };

export type RenameIssue = WalletNameIssue | { reason: "duplicate"; name: string };
export type RenameResult =
  | { ok: true; wallet: WalletSummary }
  | { ok: false; issue: { reason: "not_found" } }
  /** With the wallet as it is: the input screen shows it again without another read. */
  | { ok: false; issue: RenameIssue; wallet: WalletSummary };

/** What a click on Delete, then on "Yes, delete", finds (§9.3), with the detail to show. */
export type DeleteCheck =
  | {
      status: "confirm" | "balance_unavailable" | "blocked_pending_withdrawal";
      detail: WalletDetailData;
    }
  | { status: "blocked_balance"; detail: WalletDetailData; lamports: bigint }
  | { status: "not_found" };
export type DeleteResult = DeleteCheck | { status: "deleted" };

// Type-only imports of @launchbot/solana: erased at runtime, so this package still does not
// load it (the vault and the generator are injected).
export type GeneratedWallet = MnemonicWallet;
/** The two encrypting methods of the vault: nothing decrypts here. */
export type WalletVault = Pick<KeyVault, "encrypt" | "encryptMnemonic">;

export type WalletsDeps = {
  prisma: PrismaClient;
  balances: Pick<BalancesService, "getUserBalances" | "invalidateUserBalances">;
  generateWallet: () => GeneratedWallet;
  vault: WalletVault;
  /** `getWithdrawFeeBudgetLamports(env.PRIORITY_FEE_MAX_MICROLAMPORTS)`: the Delete threshold. */
  withdrawFeeBudgetLamports: bigint;
  now?: () => number;
};

export type WalletService = {
  /** The wallets of the user, oldest first, with their balances (cached 30 s, V1-07). */
  listWithBalances: (userId: string, options?: { skipCache?: boolean }) => Promise<WalletListData>;
  /** `null` for an id that is not a wallet of this user: a deleted one, or someone else's. */
  getOwned: (
    userId: string,
    walletId: string,
    options?: { skipCache?: boolean },
  ) => Promise<WalletDetailData | null>;
  /** The check of Create and Import (V1-12), outside the lock. */
  assertCanAdd: (userId: string) => Promise<{ ok: true } | { ok: false; reason: "limit_reached" }>;
  /** `Wallet N`, N from the number of wallets + 1, skipping the names already taken. */
  nextDefaultName: (userId: string) => Promise<string>;
  /**
   * A wallet from a 12-word phrase (decision of 16/09/2026), key and phrase stored encrypted,
   * nothing returned in clear. The limit is checked again inside a transaction under a lock
   * per user (proposal): two clicks at limit − 1 create one wallet.
   */
  create: (userId: string) => Promise<CreateWalletResult>;
  /** Normalizes the name, refuses a duplicate (case-insensitive, proposal). Same name: no write. */
  rename: (userId: string, walletId: string, rawName: string) => Promise<RenameResult>;
  /** Reads the balance without the cache (a security check, outside the Refresh throttle). */
  checkDeletable: (userId: string, walletId: string) => Promise<DeleteCheck>;
  /** Checks again, then erases the row and its key (§9.3). Withdrawals keep their history. */
  delete: (userId: string, walletId: string) => Promise<DeleteResult>;
};

const LIMIT_REACHED = { ok: false, reason: "limit_reached" } as const;
/** A name can only collide with a rename racing the lock: one retry is plenty, two is safe. */
const NAME_ATTEMPTS = 3;

const defaultName = (n: number): string => `Wallet ${n}`;

/** The names of the user: their number is the wallet count, one read serves both. */
const namesOf = async (db: Db, userId: string): Promise<string[]> =>
  (await db.wallet.findMany({ where: { userId }, select: { name: true } })).map((row) => row.name);

function nextName(names: string[]): string {
  const taken = new Set(names);
  let n = names.length + 1;
  while (taken.has(defaultName(n))) n++;
  return defaultName(n);
}

export function createWalletService(deps: WalletsDeps): WalletService {
  const {
    prisma,
    balances,
    generateWallet,
    vault,
    withdrawFeeBudgetLamports,
    now = Date.now,
  } = deps;
  const clock = () => new Date(now());

  const limitOf = async (db: Db, userId: string): Promise<number> =>
    getWalletLimit((await getActiveSubscription(db, userId, clock()))?.plan ?? null);

  async function listWithBalances(userId: string, options?: { skipCache?: boolean }) {
    const [read, limit] = await Promise.all([
      balances.getUserBalances(userId, options),
      limitOf(prisma, userId),
    ]);
    return { ...read, count: read.wallets.length, limit };
  }

  async function assertCanAdd(userId: string) {
    const quota = await getWalletQuota(prisma, userId, clock());
    return quota.reached ? LIMIT_REACHED : { ok: true as const };
  }

  async function checkDeletable(userId: string, walletId: string): Promise<DeleteCheck> {
    const [read, pending] = await Promise.all([
      balances.getUserBalances(userId, { skipCache: true }),
      prisma.withdrawal.count({ where: { walletId, status: "PENDING" } }),
    ]);
    const wallet = read.wallets.find((candidate) => candidate.id === walletId);
    if (wallet === undefined) return { status: "not_found" };
    const detail = { wallet, fetchedAt: read.fetchedAt, status: read.status };
    // A stale balance is not a check: only a read of this very moment lets a key be erased.
    if (read.status !== "fresh" || wallet.lamports === null) {
      return { status: "balance_unavailable", detail };
    }
    if (pending > 0) return { status: "blocked_pending_withdrawal", detail };
    if (isBalanceWithdrawable(wallet.lamports, withdrawFeeBudgetLamports)) {
      return { status: "blocked_balance", detail, lamports: wallet.lamports };
    }
    return { status: "confirm", detail };
  }

  return {
    listWithBalances,
    assertCanAdd,
    checkDeletable,

    async getOwned(userId, walletId, options) {
      // The rows come with the balances: an id of another user is simply not there.
      const { wallets, fetchedAt, status } = await balances.getUserBalances(userId, options);
      const wallet = wallets.find((candidate) => candidate.id === walletId);
      return wallet === undefined ? null : { wallet, fetchedAt, status };
    },

    nextDefaultName: async (userId) => nextName(await namesOf(prisma, userId)),

    async create(userId) {
      // Outside the lock first: no key is generated for a user at the limit.
      if (!(await assertCanAdd(userId)).ok) return LIMIT_REACHED;

      // Generation and encryption (PBKDF2, tens of ms) happen before the lock is taken.
      const generated = generateWallet();
      try {
        const columns = {
          publicKey: generated.address,
          source: "CREATED" as const,
          derivationPath: generated.derivationPath,
          ...vault.encrypt(generated.secretKey, generated.address),
          ...vault.encryptMnemonic(generated.mnemonic, generated.address),
        };

        for (let attempt = 1; ; attempt++) {
          try {
            const wallet = await prisma.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${userId}`}))`;
              const names = await namesOf(tx, userId);
              if (names.length >= (await limitOf(tx, userId))) return null;
              return tx.wallet.create({
                data: { userId, name: nextName(names), ...columns },
                select: WALLET_SUMMARY_SELECT,
              });
            });
            if (wallet === null) return LIMIT_REACHED;
            // The new wallet must show everywhere at once: home, list (§4.3).
            balances.invalidateUserBalances(userId);
            return { ok: true, wallet };
          } catch (error) {
            if (attempt >= NAME_ATTEMPTS || !isUniqueViolation(error, ["userId", "name"])) {
              throw error;
            }
          }
        }
      } finally {
        generated.secretKey.dispose();
      }
    },

    async rename(userId, walletId, rawName) {
      const wallets = await prisma.wallet.findMany({
        where: { userId },
        select: WALLET_SUMMARY_SELECT,
      });
      const current = wallets.find((wallet) => wallet.id === walletId);
      if (current === undefined) return { ok: false, issue: { reason: "not_found" } };

      const issue = walletNameIssue(rawName);
      if (issue !== null) return { ok: false, issue, wallet: current };
      const name = normalizeWalletName(rawName);
      if (current.name === name) return { ok: true, wallet: current };
      const lower = name.toLowerCase();
      const taken = wallets.find(
        (wallet) => wallet.id !== walletId && wallet.name.toLowerCase() === lower,
      );
      if (taken !== undefined) {
        return { ok: false, issue: { reason: "duplicate", name: taken.name }, wallet: current };
      }

      try {
        // `updateMany` with the owner in the filter: a wallet deleted meanwhile updates nothing.
        const { count } = await prisma.wallet.updateMany({
          where: { id: walletId, userId },
          data: { name },
        });
        if (count === 0) return { ok: false, issue: { reason: "not_found" } };
      } catch (error) {
        // The unique constraint is the net under a rename that raced this one.
        if (!isUniqueViolation(error, ["userId", "name"])) throw error;
        return { ok: false, issue: { reason: "duplicate", name }, wallet: current };
      }
      // The name is a user input: not logged.
      log.info({ userId, walletId }, "wallet.renamed");
      balances.invalidateUserBalances(userId);
      return { ok: true, wallet: { ...current, name } };
    },

    async delete(userId, walletId) {
      // SOL can arrive between the confirmation screen and the click: checked again.
      const check = await checkDeletable(userId, walletId);
      if (check.status !== "confirm") return check;
      const { count } = await prisma.wallet.deleteMany({ where: { id: walletId, userId } });
      if (count === 0) return { status: "not_found" };
      log.info({ userId, walletId }, "wallet.deleted");
      balances.invalidateUserBalances(userId);
      return { status: "deleted" };
    },
  };
}
