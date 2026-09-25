import { INACTIVE_ACCOUNTS_PAGE_SIZE } from "@launchbot/shared";
import type { SweptTransfer } from "@launchbot/shared";
import type { Prisma } from "../generated/prisma/client.js";
import type {
  AccountDeletionService,
  DeleteUserResult,
  DeletionCounts,
} from "./account-deletion.js";
import { createAccountSweeper } from "./account-sweep.js";
import type { AccountSweeper, AccountSweeperDeps, KeptSweep } from "./account-sweep.js";

// The inactive accounts (§11.2, §11.3, V1-45, decision of 16/09/2026): no activity for 24 h
// (`INACTIVITY_DELETE_MS`, 48 h until 25/09/2026), an admin excepted, and the account is deleted
// without a word — after the SOL of its wallets went to the treasury (account-sweep.ts, kind
// INACTIVITY_SWEEP, kept with the Telegram id for a refund by hand).

const USER_SELECT = {
  id: true,
  telegramId: true,
  username: true,
  firstName: true,
  lastActiveAt: true,
} as const satisfies Prisma.UserSelect;

export type InactiveUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** The keyset of the pages of candidates: never an offset, the rows go as they are deleted. */
export type CandidateCursor = Pick<InactiveUser, "id" | "lastActiveAt">;

export type AccountOutcome =
  | { status: "DELETED"; transfers: SweptTransfer[]; counts: DeletionCounts }
  /** Not deleted at this pass: tried again at the next one. */
  | KeptSweep
  /** The user came back: the account stays, the SOL already moved is refunded by hand. */
  | { status: "ACTIVE"; transfers: SweptTransfer[] }
  | { status: "NOT_FOUND" };

export type InactiveAccountsDeps = AccountSweeperDeps & {
  deletion: Pick<AccountDeletionService, "deleteUserData">;
};

export type InactiveAccountsService = {
  /** The transfers still PENDING, a purge's too (account-sweep.ts), settled from the chain. */
  resolvePendingSweeps: AccountSweeper["resolvePendingSweeps"];
  /** A page of accounts inactive since `cutoff`, admins left out, oldest activity first. */
  listCandidates: (
    cutoff: Date,
    adminIds: readonly number[],
    after?: CandidateCursor,
  ) => Promise<InactiveUser[]>;
  /** One account: its SOL to the treasury, then its deletion if nothing is left to move. */
  processAccount: (user: InactiveUser, cutoff: Date) => Promise<AccountOutcome>;
};

export function createInactiveAccountsService(deps: InactiveAccountsDeps): InactiveAccountsService {
  const { prisma, deletion } = deps;
  const sweeper = createAccountSweeper(deps);

  async function processAccount(candidate: InactiveUser, cutoff: Date): Promise<AccountOutcome> {
    const user = await prisma.user.findUnique({ where: { id: candidate.id }, select: USER_SELECT });
    if (user === null) return { status: "NOT_FOUND" };
    if (user.lastActiveAt >= cutoff) return { status: "ACTIVE", transfers: [] };

    const swept = await sweeper.sweepAccount(user, {
      kind: "INACTIVITY_SWEEP",
      onlyIfLastActiveBefore: cutoff,
    });
    if (swept.status === "KEPT") {
      return swept.reason === "USER_ACTIVE"
        ? { status: "ACTIVE", transfers: swept.transfers }
        : swept;
    }
    const deleted = await deletion.deleteUserData(user.id, { onlyIfLastActiveBefore: cutoff });
    return outcomeOf(deleted, swept.transfers);
  }

  return {
    resolvePendingSweeps: sweeper.resolvePendingSweeps,

    listCandidates: (cutoff, adminIds, after) =>
      prisma.user.findMany({
        where: {
          lastActiveAt: { lt: cutoff },
          // An empty list exempts nobody.
          ...(adminIds.length === 0 ? {} : { telegramId: { notIn: adminIds.map(BigInt) } }),
          ...(after === undefined
            ? {}
            : {
                OR: [
                  { lastActiveAt: { gt: after.lastActiveAt } },
                  { lastActiveAt: after.lastActiveAt, id: { gt: after.id } },
                ],
              }),
        },
        orderBy: [{ lastActiveAt: "asc" }, { id: "asc" }],
        take: INACTIVE_ACCOUNTS_PAGE_SIZE,
        select: USER_SELECT,
      }),

    processAccount,
  };
}

function outcomeOf(deleted: DeleteUserResult, transfers: SweptTransfer[]): AccountOutcome {
  if (deleted.status === "DELETED") return { status: "DELETED", transfers, counts: deleted.counts };
  if (deleted.status === "NOT_FOUND") return { status: "NOT_FOUND" };
  return { status: "ACTIVE", transfers };
}
