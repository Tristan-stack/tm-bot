import { isBalanceWithdrawable } from "@launchbot/shared";
import type { SweptTransfer } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { KeyVault } from "@launchbot/solana";
import type {
  Prisma,
  PrismaClient,
  Withdrawal,
  WithdrawalKind,
} from "../generated/prisma/client.js";
import { sendRecorded, settleTransfer, WALLET_SIGNER_SELECT } from "./withdrawals.js";
import type { TransferApi } from "./withdrawals.js";

// The SOL of an account moved to the treasury before the account is deleted: an inactive account
// (V1-45, INACTIVITY_SWEEP) or a purge (V1-44, PURGE_SWEEP, decision of 25/09/2026). Each
// transfer is a `Withdrawal` kept with the Telegram id for a refund by hand. No key is erased
// while a transfer is due, failed or in flight: the caller deletes on `SWEPT` only.

const log = createLogger("db:account-sweep");

/** The transfers of an account to the treasury before its deletion, one kind per caller. */
export const ACCOUNT_SWEEP_KINDS = [
  "INACTIVITY_SWEEP",
  "PURGE_SWEEP",
] as const satisfies WithdrawalKind[];

export type SweepKind = (typeof ACCOUNT_SWEEP_KINDS)[number];

/** A wallet with its key columns: they leave the table into `send` only, to sign (§9.6). */
export type SweepWallet = Prisma.WalletGetPayload<{ select: typeof WALLET_SIGNER_SELECT }>;

export type SweepFailure = "READ_FAILED" | "TX_FAILED" | "TX_PENDING" | "USER_ACTIVE";

export type SweepAccount = { id: string; telegramId: bigint };

export type SweepOptions = {
  kind: SweepKind;
  /**
   * An inactive account (V1-45): `lastActiveAt` is read again before each transfer, and a user
   * active since this date stops everything (`USER_ACTIVE`). A purge moves everything.
   */
  onlyIfLastActiveBefore?: Date;
};

export type SweepContext = SweepOptions & { user: SweepAccount; lamports: bigint };

/**
 * One step on one wallet worth moving: `sweepSol` in V1, V2-07 adds the tokens before it (to
 * the associated token account of the treasury).
 */
export type SweepStep = (
  wallet: SweepWallet,
  context: SweepContext,
) => Promise<{ ok: true; transfer: SweptTransfer } | { ok: false; reason: SweepFailure }>;

/** Something could not move: keep every key, try again later. */
export type KeptSweep = {
  status: "KEPT";
  reason: SweepFailure | "FUNDS_LEFT";
  transfers: SweptTransfer[];
};

export type AccountSweep =
  /** Nothing left worth moving: the account can go. */
  { status: "SWEPT"; transfers: SweptTransfer[] } | KeptSweep;

export type AccountSweeperDeps = {
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
  now?: () => Date;
};

export type AccountSweeper = {
  /**
   * The transfers of every kind still PENDING (a crash, an unknown outcome, a purge stopped on
   * one), settled from the chain whatever became of their account.
   */
  resolvePendingSweeps: () => Promise<{ confirmed: number; failed: number; unresolved: number }>;
  /** Every wallet of the account worth a transfer emptied into the treasury, oldest first. */
  sweepAccount: (user: SweepAccount, options: SweepOptions) => Promise<AccountSweep>;
};

/** The log events of a kind: `inactive.sweep` (V1-45) or `purge.sweep` (V1-44). */
const eventOf = (kind: SweepKind, event: string) =>
  `${kind === "PURGE_SWEEP" ? "purge" : "inactive"}.${event}`;

export function createAccountSweeper(deps: AccountSweeperDeps): AccountSweeper {
  const { prisma, transfer, vault, readLamports, treasury, feeBudgetLamports } = deps;
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
  async function settlePending(wallets: SweepWallet[]): Promise<boolean> {
    const pending = await prisma.withdrawal.findMany({
      // A wallet sends from its own address: the index of the deposits (V1-33) serves here too.
      where: { fromAddress: { in: wallets.map((wallet) => wallet.publicKey) }, status: "PENDING" },
    });
    let settled = true;
    for (const row of pending) {
      if ((await settleRow(row)) === "in_flight") settled = false;
    }
    return settled;
  }

  /** The balances of this very moment, or `null` when the RPC does not answer. */
  async function balancesOf(
    wallets: SweepWallet[],
    kind: SweepKind,
  ): Promise<Map<string, bigint> | null> {
    try {
      return await readLamports(wallets.map((wallet) => wallet.publicKey));
    } catch (error) {
      log.error({ err: error, wallets: wallets.length }, eventOf(kind, "read_failed"));
      return null;
    }
  }

  const worthMoving = (balances: Map<string, bigint>, wallet: SweepWallet) =>
    isBalanceWithdrawable(balances.get(wallet.publicKey) ?? 0n, feeBudgetLamports);

  const sweepSol: SweepStep = async (wallet, { user, kind, onlyIfLastActiveBefore }) => {
    if (onlyIfLastActiveBefore !== undefined) {
      // Proposal: read again before each transfer, the user may be back since the last one.
      const current = await prisma.user.findUnique({
        where: { id: user.id },
        select: { lastActiveAt: true },
      });
      if (current === null) return { ok: false, reason: "READ_FAILED" };
      if (current.lastActiveAt >= onlyIfLastActiveBefore) {
        return { ok: false, reason: "USER_ACTIVE" };
      }
    }

    const { encSecretKey, iv, authTag, id: walletId, publicKey: from } = wallet;
    const sent = await sendRecorded(
      { prisma, send: transfer.send },
      // `max`: the whole balance minus the fees, V1-13 reads it again right before the send.
      { from, to: treasury, mode: "max", amountLamports: 0n },
      { kind: "vault", vault, enc: { encSecretKey, iv, authTag }, address: from },
      { userId: user.id, walletId, kind, userTelegramId: user.telegramId, createdAt: now() },
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
        eventOf(kind, "sweep"),
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
      eventOf(kind, "sweep"),
    );
    return { ok: false, reason: pending ? "TX_PENDING" : "TX_FAILED" };
  };

  /**
   * Each wallet worth a transfer, in the order of creation (V1-45, `sweepUserWallets`). A failure
   * goes on with the next wallet, the account is kept anyway; the user back stops everything.
   */
  async function sweepUserWallets(
    user: SweepAccount,
    options: SweepOptions,
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
        const result = await step(wallet, { ...options, user, lamports });
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

  return {
    async resolvePendingSweeps() {
      const pending = await prisma.withdrawal.findMany({
        where: { kind: { in: ACCOUNT_SWEEP_KINDS }, status: "PENDING" },
        orderBy: { createdAt: "asc" },
      });
      const report = { confirmed: 0, failed: 0, unresolved: 0 };
      const counter = { landed: "confirmed", failed: "failed", in_flight: "unresolved" } as const;
      for (const row of pending) report[counter[await settleRow(row)]] += 1;
      return report;
    },

    async sweepAccount(user, options) {
      const wallets = await prisma.wallet.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: WALLET_SIGNER_SELECT,
      });
      if (wallets.length === 0) return { status: "SWEPT", transfers: [] };
      const kept = (reason: KeptSweep["reason"], transfers: SweptTransfer[] = []): KeptSweep => ({
        status: "KEPT",
        reason,
        transfers,
      });

      // A transfer of a previous attempt, or a withdrawal of the user, still in flight: the chain
      // first, never a second transfer over it.
      if (!(await settlePending(wallets))) return kept("TX_PENDING");
      const balances = await balancesOf(wallets, options.kind);
      if (balances === null) return kept("READ_FAILED");

      const swept = await sweepUserWallets(user, options, wallets, balances);
      if (swept.failure !== undefined) return kept(swept.failure, swept.transfers);

      // Proposal: SOL that arrived since the read stays with its key for the next attempt.
      // Nothing sent, the read of a moment ago is still the one.
      const after =
        swept.transfers.length === 0 ? balances : await balancesOf(wallets, options.kind);
      if (after === null) return kept("READ_FAILED", swept.transfers);
      if (wallets.some((wallet) => worthMoving(after, wallet))) {
        return kept("FUNDS_LEFT", swept.transfers);
      }
      return { status: "SWEPT", transfers: swept.transfers };
    },
  };
}
