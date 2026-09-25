import {
  classifyDeposit,
  DEPOSIT_WATCH_MS,
  effectiveStatus,
  isBalanceWithdrawable,
  isWatchable,
  mayMoveDeposit,
  SWEEP_DUST_LAMPORTS,
} from "@launchbot/shared";
import type { AlertInvoice, DepositAlert, DepositCase } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { KeyVault } from "@launchbot/solana";
import type { PaymentStatus, Prisma, PrismaClient } from "../generated/prisma/client.js";
import { readBalancesInGroups } from "./balances.js";
import { errorText, sendRecorded, settleTransfer } from "./withdrawals.js";
import type { ConfirmedTransfer, TransferApi } from "./withdrawals.js";

// The deposit addresses of the invoices after their payment (§8.3, §11.3, V1-33): their funds
// go to the treasury, each address is watched 30 days, then its key is erased. Only the worker
// decrypts a deposit key, inside `send`, to sign (§9.6). Every transfer to the treasury is a
// `Withdrawal` of kind DEPOSIT_SWEEP, recorded like a withdrawal (`sendRecorded`): an outcome
// the RPC could not give is looked up (`settleTransfer`), never sent a second time.

const log = createLogger("db:treasury");

export type TreasuryDeps = {
  prisma: PrismaClient;
  transfer: Pick<TransferApi, "send" | "lookup">;
  vault: KeyVault;
  /** Balances at `confirmed`, without cache (`getBalancesFresh`). */
  readLamports: (addresses: readonly string[]) => Promise<Map<string, bigint>>;
  /** `TREASURY_WALLET`: a public key, no treasury key exists in the project. */
  treasury: string;
  /**
   * `getWithdrawFeeBudgetLamports(PRIORITY_FEE_MAX_MICROLAMPORTS)`: what a transfer can cost at
   * most. A balance above it plus the dust is worth moving, decided without a fee estimate.
   */
  feeBudgetLamports: bigint;
  /** The sender of the last deposit (proposal), for the alert; `null` when the chain won't say. */
  findSender: (address: string) => Promise<string | null>;
  now?: () => Date;
};

export type SweepResult =
  | {
      kind: "SWEPT";
      depositCase: DepositCase;
      signature: string;
      lamports: bigint;
      /** For the admins: `null` for a PAID invoice, the normal case. */
      alert: DepositAlert | null;
    }
  /** No key, not movable (PENDING, within its 24 h), or only dust once the fees are paid. */
  | { kind: "NOTHING_TO_SWEEP" }
  /** A previous transfer may still land: nothing is sent until the chain says. */
  | { kind: "IN_FLIGHT" }
  | { kind: "FAILED"; reason: string };

export type TreasuryService = {
  /** Every PAID invoice that still has its funds (V1-33 A): its id, for `deposits.sweep`. */
  listPaidToSweep: () => Promise<string[]>;
  /**
   * The addresses of B, read in groups of 100: the ids whose balance is worth a transfer.
   * A read that fails skips its group until the next pass.
   */
  watch: (now: Date) => Promise<string[]>;
  /** One transfer of a whole deposit to the treasury, classified and recorded (§8.3). */
  sweepDeposit: (paymentId: string) => Promise<SweepResult>;
  /**
   * SWEEP FAILED, once per invoice until a transfer succeeds again: `null` when it went out
   * already. `attempts`: `null` for an invoice found unmoved when its key was due to go.
   */
  failureAlert: (
    paymentId: string,
    reason: string,
    attempts: number | null,
  ) => Promise<DepositAlert | null>;
  /**
   * Keys past their 30 days (D): erased, or kept for a transfer first (`sweep`). A PAID invoice
   * never moved keeps its key: its SWEEP FAILED alerts are returned.
   */
  purgeKeys: (now: Date) => Promise<{ purged: number; sweep: string[]; alerts: DepositAlert[] }>;
};

/** What an alert shows of an invoice: never its key. */
const ALERT_SELECT = {
  id: true,
  userId: true,
  plan: true,
  duration: true,
  priceUsd: true,
  expectedLamports: true,
  receivedLamports: true,
  depositAddress: true,
  status: true,
  expiresAt: true,
  canceledAt: true,
  sweepSignature: true,
  createdAt: true,
  user: { select: { telegramId: true, username: true } },
} as const satisfies Prisma.PaymentSelect;

/** The key columns too: they leave the table into `send` only. */
const SWEEP_SELECT = {
  ...ALERT_SELECT,
  encSecretKey: true,
  iv: true,
  authTag: true,
} as const satisfies Prisma.PaymentSelect;

const DEPOSIT_SELECT = {
  id: true,
  status: true,
  expiresAt: true,
  canceledAt: true,
  depositAddress: true,
} as const satisfies Prisma.PaymentSelect;

type AlertRow = Prisma.PaymentGetPayload<{ select: typeof ALERT_SELECT }>;
type SweepRow = Prisma.PaymentGetPayload<{ select: typeof SWEEP_SELECT }>;

/** An invoice as the treasury handles it: never PENDING, by its effective status. */
type Settled<T extends { status: PaymentStatus }> = Omit<T, "status"> & {
  status: Exclude<PaymentStatus, "PENDING">;
};

/** Read by its effective status: a PENDING invoice past its 30 minutes is EXPIRED (V1-28). */
function settledStatus<T extends AlertRow>(row: T, now: Date): Settled<T> | null {
  const status = effectiveStatus(row, now);
  return status === "PENDING" ? null : { ...row, status };
}

const alertInvoice = (row: Settled<AlertRow>): AlertInvoice => ({
  plan: row.plan,
  duration: row.duration,
  createdAt: row.createdAt,
  priceUsd: row.priceUsd.toFixed(2),
  expectedLamports: row.expectedLamports,
  depositAddress: row.depositAddress,
  status: row.status,
});

export function createTreasuryService(deps: TreasuryDeps): TreasuryService {
  const {
    prisma,
    transfer,
    vault,
    readLamports,
    treasury,
    feeBudgetLamports,
    findSender,
    now = () => new Date(),
  } = deps;

  /** Worth a transfer: more than a transfer can cost, plus the dust (proposal). */
  const worthMoving = (balance: bigint) =>
    isBalanceWithdrawable(balance, feeBudgetLamports + SWEEP_DUST_LAMPORTS);

  const readDeposits = (rows: readonly { depositAddress: string }[]) =>
    readBalancesInGroups(
      readLamports,
      rows.map((row) => row.depositAddress),
    );

  /**
   * The funds moved: the transfer turns CONFIRMED and the invoice records it in the same
   * transaction — a transfer on file without its invoice would leave a PAID invoice whose
   * deposit reads empty. PAID becomes SWEPT; any other status stays (the invoice was not paid),
   * with the funds counted. Then what the admins must know.
   */
  async function recordSwept(
    row: Settled<SweepRow>,
    withdrawalId: string,
    confirmed: ConfirmedTransfer,
    balance: bigint,
  ): Promise<SweepResult> {
    const { signature, lamports } = confirmed;
    const depositCase = classifyDeposit(row, balance);
    // A first transfer takes the balance of the deposit; a later one adds funds sent since.
    const receivedLamports =
      row.sweepSignature !== null
        ? row.receivedLamports + balance
        : balance > row.receivedLamports
          ? balance
          : row.receivedLamports;
    const paid = row.status === "PAID";
    await prisma.$transaction([
      prisma.withdrawal.update({ where: { id: withdrawalId }, data: confirmed }),
      prisma.payment.updateMany({
        where: paid ? { id: row.id, status: "PAID" } : { id: row.id },
        data: {
          sweepSignature: signature,
          sweepAlertedAt: null,
          receivedLamports,
          ...(paid ? { status: "SWEPT" as const } : {}),
        },
      }),
    ]);
    log.info(
      { paymentId: row.id, depositCase, lamports: lamports.toString(), signature },
      "payment.swept",
    );
    if (depositCase === "PAID") {
      return { kind: "SWEPT", depositCase, signature, lamports, alert: null };
    }

    let from: string | null = null;
    try {
      from = await findSender(row.depositAddress);
    } catch (error) {
      log.warn({ err: error, paymentId: row.id }, "treasury.sender_unknown");
    }
    return {
      kind: "SWEPT",
      depositCase,
      signature,
      lamports,
      alert: {
        kind: depositCase,
        invoice: alertInvoice(row),
        user: row.user,
        balanceLamports: balance,
        movedLamports: lamports,
        signature,
        ...(from === null ? {} : { from }),
      },
    };
  }

  async function sweepDeposit(paymentId: string): Promise<SweepResult> {
    const at = now();
    const found = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: SWEEP_SELECT,
    });
    const row = found === null ? null : settledStatus(found, at);
    // No key (erased after 30 days), or not movable yet: never within the 24 h (§8.3).
    if (row === null || !mayMoveDeposit(row, at)) return { kind: "NOTHING_TO_SWEEP" };
    const { encSecretKey, iv, authTag, depositAddress: deposit } = row;
    if (encSecretKey === null || iv === null || authTag === null) {
      return { kind: "NOTHING_TO_SWEEP" };
    }

    const pending = await prisma.withdrawal.findFirst({
      where: { fromAddress: deposit, kind: "DEPOSIT_SWEEP", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (pending !== null) {
      const settled = await settleTransfer(transfer.lookup, pending, at.getTime());
      if (settled.status === "in_flight") return { kind: "IN_FLIGHT" };
      if (settled.status === "landed") {
        // It landed after all: what it moved plus its fees is what the deposit held.
        const feeLamports = pending.feeLamports ?? 0n;
        const confirmed: ConfirmedTransfer = {
          status: "CONFIRMED",
          signature: settled.signature,
          feeLamports,
          lamports: pending.lamports,
        };
        return recordSwept(row, pending.id, confirmed, pending.lamports + feeLamports);
      }
      await prisma.withdrawal.update({
        where: { id: pending.id },
        data: { status: "FAILED", error: settled.error },
      });
    }

    // One cheap read before anything is quoted: dust is left where it is.
    const balance = (await readDeposits([row])).get(deposit);
    if (balance === undefined) return { kind: "FAILED", reason: "RPC_UNAVAILABLE" };
    if (!worthMoving(balance)) return { kind: "NOTHING_TO_SWEEP" };

    const sent = await sendRecorded(
      { prisma, send: transfer.send },
      // `max`: the whole balance minus the fees, 0 left (§9.5); the amount field is not read.
      { from: deposit, to: treasury, mode: "max", amountLamports: 0n },
      { kind: "vault", vault, enc: { encSecretKey, iv, authTag }, address: deposit },
      // The clock of the service: the age of an attempt in flight is read with it.
      { userId: row.userId, kind: "DEPOSIT_SWEEP", createdAt: at },
    );
    if (sent.status === "sent") {
      return recordSwept(row, sent.row.id, sent.confirmed, sent.quote.balanceLamports);
    }
    const { failure } = sent;
    log.warn({ paymentId, code: failure.code, landed: failure.landed }, "treasury.sweep_failed");
    return { kind: "FAILED", reason: errorText(failure.code, failure.detail) };
  }

  async function failureAlert(
    paymentId: string,
    reason: string,
    attempts: number | null,
  ): Promise<DepositAlert | null> {
    const found = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: ALERT_SELECT,
    });
    const row = found === null ? null : settledStatus(found, now());
    if (row === null) return null;
    const { count } = await prisma.payment.updateMany({
      where: { id: paymentId, sweepAlertedAt: null },
      data: { sweepAlertedAt: now() },
    });
    if (count === 0) return null;
    // Read again for the admin; without it, they read it on the explorer.
    const balanceLamports = (await readDeposits([row])).get(row.depositAddress) ?? null;
    log.error({ paymentId, reason }, "payment.sweep_gave_up");
    return {
      kind: "SWEEP_FAILED",
      invoice: alertInvoice(row),
      user: row.user,
      balanceLamports,
      reason,
      attempts,
    };
  }

  return {
    async listPaidToSweep() {
      const rows = await prisma.payment.findMany({
        where: { status: "PAID", encSecretKey: { not: null } },
        orderBy: { paidAt: "asc" },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },

    async watch(at) {
      const rows = await prisma.payment.findMany({
        where: {
          status: { in: ["SWEPT", "EXPIRED", "CANCELED"] },
          encSecretKey: { not: null },
          expiresAt: { gt: new Date(at.getTime() - DEPOSIT_WATCH_MS) },
        },
        select: DEPOSIT_SELECT,
      });
      const watched = rows.filter((row) => isWatchable(row, at));
      const balances = await readDeposits(watched);
      return watched
        .filter((row) => worthMoving(balances.get(row.depositAddress) ?? 0n))
        .map((row) => row.id);
    },

    sweepDeposit,
    failureAlert,

    async purgeKeys(at) {
      const rows = await prisma.payment.findMany({
        where: {
          status: { not: "PENDING" },
          encSecretKey: { not: null },
          expiresAt: { lte: new Date(at.getTime() - DEPOSIT_WATCH_MS) },
        },
        select: DEPOSIT_SELECT,
      });
      const balances = await readDeposits(rows);
      const sweep: string[] = [];
      const alerts: DepositAlert[] = [];
      const erase: string[] = [];
      for (const row of rows) {
        const balance = balances.get(row.depositAddress);
        // Unread: the key waits for the next pass, a balance is never assumed.
        if (balance === undefined) continue;
        if (worthMoving(balance)) {
          sweep.push(row.id);
        } else if (row.status === "PAID") {
          // Never moved: the key is the only way to the funds.
          const alert = await failureAlert(row.id, "NEVER_SWEPT", null);
          if (alert !== null) alerts.push(alert);
        } else {
          erase.push(row.id);
        }
      }
      // The address, the amounts, the status and the signatures stay: the books.
      const { count: purged } = await prisma.payment.updateMany({
        where: {
          id: { in: erase },
          status: { notIn: ["PENDING", "PAID"] },
          encSecretKey: { not: null },
        },
        data: { encSecretKey: null, iv: null, authTag: null, keyDeletedAt: at },
      });
      if (purged > 0) log.info({ purged }, "payment.deposit_keys_purged");
      return { purged, sweep, alerts };
    },
  };
}
