import { INACTIVE_ACCOUNTS_PAGE_SIZE, isBalanceWithdrawable } from "@launchbot/shared";
import type { SweptTransfer } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { KeyVault } from "@launchbot/solana";
import type { Prisma, PrismaClient, Withdrawal } from "../generated/prisma/client.js";
import type {
  AccountDeletionService,
  DeleteUserResult,
  DeletionCounts,
} from "./account-deletion.js";
import { sendRecorded, settleTransfer, WALLET_SIGNER_SELECT } from "./withdrawals.js";
import type { TransferApi } from "./withdrawals.js";

// The inactive accounts (§11.2, §11.3, V1-45, decision of 16/09/2026): no activity for 24 h
// (`INACTIVITY_DELETE_MS`, 48 h until 25/09/2026), an admin excepted, and the account is deleted
// without a word — after the SOL of its wallets went
// to the treasury, each transfer a `Withdrawal` of kind INACTIVITY_SWEEP kept with the Telegram
// id for a refund by hand. No key is erased while a transfer is due, failed or in flight.

const log = createLogger("db:inactive-accounts");

const USER_SELECT = {
  id: true,
  telegramId: true,
  username: true,
  firstName: true,
  lastActiveAt: true,
} as const satisfies Prisma.UserSelect;

export type InactiveUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

/** A wallet with its key columns: they leave the table into `send` only, to sign (§9.6). */
export type SweepWallet = Prisma.WalletGetPayload<{ select: typeof WALLET_SIGNER_SELECT }>;

/** The keyset of the pages of candidates: never an offset, the rows go as they are deleted. */
export type CandidateCursor = Pick<InactiveUser, "id" | "lastActiveAt">;

export type SweepFailure = "READ_FAILED" | "TX_FAILED" | "TX_PENDING" | "USER_ACTIVE";

export type SweepContext = { user: InactiveUser; cutoff: Date; lamports: bigint };

/**
 * One step on one wallet worth moving: `sweepSol` in V1, V2-07 adds the tokens before it (to
 * the associated token account of the treasury).
 */
export type SweepStep = (
  wallet: SweepWallet,
  context: SweepContext,
) => Promise<{ ok: true; transfer: SweptTransfer } | { ok: false; reason: SweepFailure }>;

export type AccountOutcome =
  | { status: "DELETED"; transfers: SweptTransfer[]; counts: DeletionCounts }
  /** Not deleted at this pass: tried again at the next one. */
  | { status: "KEPT"; reason: SweepFailure | "FUNDS_LEFT"; transfers: SweptTransfer[] }
  /** The user came back: the account stays, the SOL already moved is refunded by hand. */
  | { status: "ACTIVE"; transfers: SweptTransfer[] }
  | { status: "NOT_FOUND" };

export type InactiveAccountsDeps = {
  prisma: PrismaClient;
  transfer: Pick<TransferApi, "send" | "lookup">;
  /** The one vault of the process: a key is decrypted inside `send`, to sign, nowhere else. */
  vault: KeyVault;
  /** Balances at `confirmed`, without cache (`getBalancesFresh`). */
  readLamports: (addresses: readonly string[]) => Promise<Map<string, bigint>>;
  /** `TREASURY_WALLET`. */
  treasury: string;
  /** `getWithdrawFeeBudgetLamports(PRIORITY_FEE_MAX_MICROLAMPORTS)`: under it, dust, lost. */
  feeBudgetLamports: bigint;
  deletion: Pick<AccountDeletionService, "deleteUserData">;
  now?: () => Date;
};

export type InactiveAccountsService = {
  /** The INACTIVITY_SWEEP transfers still PENDING (a crash, an unknown outcome), from the chain. */
  resolvePendingSweeps: () => Promise<{ confirmed: number; failed: number; unresolved: number }>;
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
  const { prisma, transfer, vault, readLamports, treasury, feeBudgetLamports, deletion } = deps;
  const now = deps.now ?? (() => new Date());

  /** A PENDING transfer read on the chain, its row updated once it landed or failed. */
  async function settleRow(row: Withdrawal): Promise<"landed" | "failed" | "in_flight"> {
    const result = await settleTransfer(transfer.lookup, row, now().getTime());
    if (result.status === "in_flight") return "in_flight";
    await prisma.withdrawal.update({
      where: { id: row.id },
      data:
        result.status === "landed"
          ? { status: "CONFIRMED", signature: result.signature }
          : { status: "FAILED", error: result.error },
    });
    return result.status;
  }

  /** `false` while one of them may still land: nothing is signed over it. */
  async function settlePending(walletIds: string[]): Promise<boolean> {
    const pending = await prisma.withdrawal.findMany({
      where: { walletId: { in: walletIds }, status: "PENDING" },
    });
    let settled = true;
    for (const row of pending) {
      if ((await settleRow(row)) === "in_flight") settled = false;
    }
    return settled;
  }

  /** The balances of this very moment, or `null` when the RPC does not answer. */
  async function balancesOf(wallets: SweepWallet[]): Promise<Map<string, bigint> | null> {
    try {
      return await readLamports(wallets.map((wallet) => wallet.publicKey));
    } catch (error) {
      log.error({ err: error, wallets: wallets.length }, "inactive.read_failed");
      return null;
    }
  }

  const worthMoving = (balances: Map<string, bigint>, wallet: SweepWallet) =>
    isBalanceWithdrawable(balances.get(wallet.publicKey) ?? 0n, feeBudgetLamports);

  const sweepSol: SweepStep = async (wallet, { user, cutoff }) => {
    // Proposal: read again before each transfer, the user may be back since the last one.
    const current = await prisma.user.findUnique({
      where: { id: user.id },
      select: { lastActiveAt: true },
    });
    if (current === null) return { ok: false, reason: "READ_FAILED" };
    if (current.lastActiveAt >= cutoff) return { ok: false, reason: "USER_ACTIVE" };

    const { encSecretKey, iv, authTag, id: walletId, publicKey: from } = wallet;
    const sent = await sendRecorded(
      { prisma, send: transfer.send },
      // `max`: the whole balance minus the fees, V1-13 reads it again right before the send.
      { from, to: treasury, mode: "max", amountLamports: 0n },
      { kind: "vault", vault, enc: { encSecretKey, iv, authTag }, address: from },
      {
        userId: user.id,
        walletId,
        kind: "INACTIVITY_SWEEP",
        userTelegramId: user.telegramId,
        createdAt: now(),
      },
    );
    const logged = { userId: user.id, walletId };
    if (sent.status === "sent") {
      await prisma.withdrawal.update({ where: { id: sent.row.id }, data: sent.confirmed });
      const { lamports, signature } = sent.confirmed;
      log.info(
        {
          ...logged,
          withdrawalId: sent.row.id,
          lamports: lamports.toString(),
          status: "CONFIRMED",
        },
        "inactive.sweep",
      );
      return {
        ok: true,
        transfer: { walletName: wallet.name, fromAddress: from, lamports, signature },
      };
    }
    const { failure } = sent;
    const pending = sent.status === "failed" && failure.landed === "unknown";
    log.error(
      {
        ...logged,
        withdrawalId: sent.status === "failed" ? sent.row.id : undefined,
        status: pending ? "PENDING" : "FAILED",
        code: failure.code,
      },
      "inactive.sweep",
    );
    return { ok: false, reason: pending ? "TX_PENDING" : "TX_FAILED" };
  };

  /**
   * Each wallet worth a transfer, in the order of creation (V1-45, `sweepUserWallets`). A failure
   * goes on with the next wallet, the account is kept anyway; the user back stops everything.
   */
  async function sweepUserWallets(
    user: InactiveUser,
    cutoff: Date,
    wallets: SweepWallet[],
    balances: Map<string, bigint>,
    steps: SweepStep[] = [sweepSol],
  ): Promise<{ failure?: SweepFailure; transfers: SweptTransfer[] }> {
    const transfers: SweptTransfer[] = [];
    let failure: SweepFailure | undefined;
    for (const wallet of wallets) {
      // Dust under the fees of a transfer cannot leave: it is lost with the key.
      if (!worthMoving(balances, wallet)) continue;
      const lamports = balances.get(wallet.publicKey) ?? 0n;
      for (const step of steps) {
        const result = await step(wallet, { user, cutoff, lamports });
        if (!result.ok) {
          failure = result.reason;
          break;
        }
        transfers.push(result.transfer);
      }
      if (failure === "USER_ACTIVE") break;
    }
    return { failure, transfers };
  }

  async function processAccount(candidate: InactiveUser, cutoff: Date): Promise<AccountOutcome> {
    const user = await prisma.user.findUnique({ where: { id: candidate.id }, select: USER_SELECT });
    if (user === null) return { status: "NOT_FOUND" };
    if (user.lastActiveAt >= cutoff) return { status: "ACTIVE", transfers: [] };

    const wallets = await prisma.wallet.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: WALLET_SIGNER_SELECT,
    });
    const kept = (reason: SweepFailure | "FUNDS_LEFT", transfers: SweptTransfer[] = []) =>
      ({ status: "KEPT", reason, transfers }) as const;

    if (wallets.length > 0) {
      // A transfer of a previous pass, or a withdrawal of the user, still in flight: the chain
      // first, never a second transfer over it.
      if (!(await settlePending(wallets.map((wallet) => wallet.id)))) return kept("TX_PENDING");
      const balances = await balancesOf(wallets);
      if (balances === null) return kept("READ_FAILED");

      const swept = await sweepUserWallets(user, cutoff, wallets, balances);
      if (swept.failure === "USER_ACTIVE") return { status: "ACTIVE", transfers: swept.transfers };
      if (swept.failure !== undefined) return kept(swept.failure, swept.transfers);

      // Proposal: SOL that arrived since the read stays with its key for the next pass. Nothing
      // sent, the read of a moment ago is still the one.
      const after = swept.transfers.length === 0 ? balances : await balancesOf(wallets);
      if (after === null) return kept("READ_FAILED", swept.transfers);
      if (wallets.some((wallet) => worthMoving(after, wallet))) {
        return kept("FUNDS_LEFT", swept.transfers);
      }
      const deleted = await deletion.deleteUserData(user.id, { onlyIfLastActiveBefore: cutoff });
      return outcomeOf(deleted, swept.transfers);
    }
    return outcomeOf(
      await deletion.deleteUserData(user.id, { onlyIfLastActiveBefore: cutoff }),
      [],
    );
  }

  return {
    async resolvePendingSweeps() {
      const pending = await prisma.withdrawal.findMany({
        where: { kind: "INACTIVITY_SWEEP", status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      const report = { confirmed: 0, failed: 0, unresolved: 0 };
      const counter = { landed: "confirmed", failed: "failed", in_flight: "unresolved" } as const;
      for (const row of pending) report[counter[await settleRow(row)]] += 1;
      return report;
    },

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
