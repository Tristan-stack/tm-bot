import {
  acceptanceDeadline,
  effectiveStatus,
  isBalanceWithdrawable,
  LATE_PAYMENT_TOLERANCE_MS,
} from "@launchbot/shared";
import type { PlanStatus } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { Plan, PlanDuration, PrismaClient, User } from "../generated/prisma/client.js";
import { WALLET_SUMMARY_SELECT } from "./balances.js";
import { getPlanStatus } from "./subscriptions.js";
import { findUserByTelegramId, lockUserRow, sessionKeysOf } from "./user.js";

// The deletion of an account (§11.3, V1-44): /purge after its checks, and the inactive accounts
// of V1-45, both once the SOL of the wallets is in the treasury (account-sweep.ts). No Telegram
// here, no message: the callers decide.

const log = createLogger("db:account-deletion");

/** An invoice that can still activate a plan (§8.3): PENDING, or ended within its 24 h. */
export type OpenInvoice = {
  paymentId: string;
  plan: Plan;
  duration: PlanDuration;
  expectedLamports: bigint;
  status: "PENDING" | "EXPIRED" | "CANCELED";
  expiresAt: Date;
  /** Until when a full payment still activates it. */
  payableUntil: Date;
};

/**
 * Why /purge refuses (§11.3, §11.4): a payment could still land. Funds do not block since the
 * decision of 25/09/2026: they go to the treasury before the deletion.
 */
export type DeletionBlocker =
  | ({ kind: "PENDING_INVOICE" } & OpenInvoice)
  /** The RPC did not answer: a purge is never decided without the balances. */
  | { kind: "BALANCES_UNAVAILABLE" };

export type PurgeWallet = {
  id: string;
  name: string;
  publicKey: string;
  createdAt: Date;
  /** `null`: the balances could not be read. */
  lamports: bigint | null;
};

/** The summary of /purge: read at the command and again at Confirm purge, never cached. */
export type PurgeSummary = {
  user: User;
  plan: PlanStatus;
  wallets: PurgeWallet[];
  /** What the purge moves to the treasury first: the wallets above the fees of a transfer. */
  toTreasuryLamports: bigint;
  invoices: OpenInvoice[];
  blockers: DeletionBlocker[];
};

export type DeletionCounts = {
  wallets: number;
  drafts: number;
  simulations: number;
  aiGenerations: number;
  subscriptions: number;
  /** Kept for the books, detached from the account (§13). */
  payments: number;
  withdrawals: number;
};

export type DeleteUserResult =
  | { status: "DELETED"; counts: DeletionCounts }
  | { status: "NOT_FOUND" }
  /** Active since the date given: an inactive account that came back (V1-45). */
  | { status: "SKIPPED_ACTIVE" };

export type AccountDeletionDeps = {
  prisma: PrismaClient;
  /** Balances at `confirmed`, without cache or throttle (`getBalancesFresh`). */
  readLamports: (addresses: readonly string[]) => Promise<Map<string, bigint>>;
  /** `getWithdrawFeeBudgetLamports(PRIORITY_FEE_MAX_MICROLAMPORTS)`: the threshold of V1-11. */
  feeBudgetLamports: bigint;
  now?: () => Date;
};

export type AccountDeletionService = {
  /** Everything that refuses a /purge now, read without cache. Not used by V1-45. */
  getDeletionBlockers: (userId: string) => Promise<DeletionBlocker[]>;
  /** The screen of /purge for a Telegram id: `null` when no account has it. */
  getPurgeSummary: (telegramId: bigint) => Promise<PurgeSummary | null>;
  /**
   * The account and all its data, in one transaction under the lock of the user; the payments
   * and the withdrawals stay, detached (§13). Checks no blocker and moves no fund: the caller
   * has checked and moved the SOL first (V1-44, V1-45, which passes `onlyIfLastActiveBefore`).
   */
  deleteUserData: (
    userId: string,
    options?: { onlyIfLastActiveBefore?: Date },
  ) => Promise<DeleteUserResult>;
};

/** Sorted by creation, as the wallet list of the user (§9.1). */
const WALLETS = { orderBy: { createdAt: "asc" }, select: WALLET_SUMMARY_SELECT } as const;

export function createAccountDeletionService(deps: AccountDeletionDeps): AccountDeletionService {
  const { prisma, readLamports, feeBudgetLamports, now = () => new Date() } = deps;

  /** Every invoice that could still be paid in full (§8.3, `LATE_PAYMENT_TOLERANCE_MS`). */
  async function openInvoices(userId: string, at: Date): Promise<OpenInvoice[]> {
    const rows = await prisma.payment.findMany({
      where: {
        userId,
        status: { in: ["PENDING", "EXPIRED", "CANCELED"] },
        // A deadline is at most 24 h after the end: nothing older can still be paid.
        expiresAt: { gt: new Date(at.getTime() - LATE_PAYMENT_TOLERANCE_MS) },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        plan: true,
        duration: true,
        expectedLamports: true,
        status: true,
        expiresAt: true,
        canceledAt: true,
      },
    });
    return rows.flatMap((row) => {
      const status = effectiveStatus(row, at);
      if (status === "PAID" || status === "SWEPT") return [];
      const payableUntil = acceptanceDeadline({ ...row, status });
      if (at > payableUntil) return [];
      const { id, plan, duration, expectedLamports, expiresAt } = row;
      return [{ paymentId: id, plan, duration, expectedLamports, status, expiresAt, payableUntil }];
    });
  }

  /**
   * The wallets with a balance read now. Unreadable balances block: the purge could not say
   * what goes to the treasury.
   */
  async function readWallets(userId: string): Promise<{
    wallets: PurgeWallet[];
    toTreasuryLamports: bigint;
    blockers: DeletionBlocker[];
  }> {
    const rows = await prisma.wallet.findMany({ where: { userId }, ...WALLETS });
    if (rows.length === 0) return { wallets: [], toTreasuryLamports: 0n, blockers: [] };
    let balances: Map<string, bigint>;
    try {
      balances = await readLamports(rows.map((row) => row.publicKey));
    } catch (error) {
      log.warn({ err: error, userId }, "purge.balances_unavailable");
      return {
        wallets: rows.map((row) => ({ ...row, lamports: null })),
        toTreasuryLamports: 0n,
        blockers: [{ kind: "BALANCES_UNAVAILABLE" }],
      };
    }
    const wallets = rows.map((row) => ({ ...row, lamports: balances.get(row.publicKey) ?? 0n }));
    // A balance under the fees of a transfer cannot leave the wallet (§9.3): lost with the key.
    const toTreasuryLamports = wallets.reduce(
      (total, { lamports }) =>
        isBalanceWithdrawable(lamports, feeBudgetLamports) ? total + lamports : total,
      0n,
    );
    return { wallets, toTreasuryLamports, blockers: [] };
  }

  async function blockersAndSummary(userId: string, at: Date) {
    const [read, invoices] = await Promise.all([readWallets(userId), openInvoices(userId, at)]);
    const blockers: DeletionBlocker[] = [
      ...read.blockers,
      ...invoices.map((invoice): DeletionBlocker => ({ kind: "PENDING_INVOICE", ...invoice })),
    ];
    return { ...read, invoices, blockers };
  }

  return {
    getDeletionBlockers: async (userId) => (await blockersAndSummary(userId, now())).blockers,

    async getPurgeSummary(telegramId) {
      const user = await findUserByTelegramId(prisma, telegramId);
      if (user === null) return null;
      const at = now();
      const [checked, plan] = await Promise.all([
        blockersAndSummary(user.id, at),
        getPlanStatus(prisma, user.id, at),
      ]);
      return { user, plan, ...checked };
    },

    deleteUserData: (userId, options = {}) =>
      prisma.$transaction(async (tx): Promise<DeleteUserResult> => {
        const row = await lockUserRow(tx, userId);
        if (row === undefined) return { status: "NOT_FOUND" };
        const { onlyIfLastActiveBefore: before } = options;
        if (before !== undefined && row.lastActiveAt >= before) return { status: "SKIPPED_ACTIVE" };

        // An explicit order, to count the rows: the Cascade and SetNull of V1-02 stay a net.
        const where = { userId };
        const simulations = await tx.simulation.deleteMany({ where });
        const drafts = await tx.tokenDraft.deleteMany({ where });
        const aiGenerations = await tx.aiGeneration.deleteMany({ where });
        const subscriptions = await tx.subscription.deleteMany({ where });
        // `userTelegramId` stays: an inactivity sweep is found by it for a refund (V1-45).
        const withdrawals = await tx.withdrawal.updateMany({ where, data: { userId: null } });
        const payments = await tx.payment.updateMany({ where, data: { userId: null } });
        // The encrypted keys and seed phrases go with the rows; `Withdrawal.walletId` → null.
        const wallets = await tx.wallet.deleteMany({ where });
        await tx.session.deleteMany({ where: { key: { in: sessionKeysOf(row.telegramId) } } });
        await tx.user.delete({ where: { id: userId } });

        const counts: DeletionCounts = {
          wallets: wallets.count,
          drafts: drafts.count,
          simulations: simulations.count,
          aiGenerations: aiGenerations.count,
          subscriptions: subscriptions.count,
          payments: payments.count,
          withdrawals: withdrawals.count,
        };
        log.info({ userId, ...counts }, "account.deleted");
        return { status: "DELETED", counts };
      }),
  };
}
