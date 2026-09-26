import {
  computeMaxAmount,
  isBalanceWithdrawable,
  WITHDRAWAL_ERROR_MAX_CHARS,
  WITHDRAWAL_IN_FLIGHT_MS,
} from "@launchbot/shared";
import type { WithdrawalPresetPct } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type {
  KeyVault,
  SignatureOutcome,
  SignerSource,
  TransferApi,
  TransferQuote,
  TransferRequest,
  TxFailure,
  TxSuccess,
} from "@launchbot/solana";
import type { Prisma, PrismaClient, Withdrawal } from "../generated/prisma/client.js";
import { MANAGED_WALLET, readFreshWallet, WALLET_SUMMARY_SELECT } from "./balances.js";
import type { BalancesService, WalletDetailData } from "./balances.js";
import type { WalletSummary } from "./wallets.js";

const log = createLogger("db:withdrawals");

/** What the amount step offers (§9.5): a share of the balance, the whole of it, or a number. */
export type WithdrawAmount =
  { kind: "pct"; pct: WithdrawalPresetPct } | { kind: "max" } | { kind: "exact"; lamports: bigint };
/** What is sent: a share has been resolved to a number by then. */
export type WithdrawRequest = Exclude<WithdrawAmount, { kind: "pct" }>;
/**
 * What `execute` sends: a withdrawal, or a `debit`, a total the fees come out of — the funding
 * of a launch wallet (decision of 26/09/2026), never a withdrawal screen.
 */
export type SendAmount = WithdrawRequest | { kind: "debit"; lamports: bigint };

/** The lamports of a choice of the amount step: a share is floored to the lamport (proposal). */
export const resolveWithdrawAmount = (balance: bigint, amount: WithdrawAmount): bigint | "max" =>
  amount.kind === "max"
    ? "max"
    : amount.kind === "exact"
      ? amount.lamports
      : (balance * BigInt(amount.pct)) / 100n;

/** A click on Withdraw found a wallet that can withdraw, with what the amount step shows. */
export type WithdrawOkCheck = {
  status: "ok";
  detail: WalletDetailData;
  lamports: bigint;
  /** A standard transfer at the priority fee of now: the « ≈ » of the amount step. */
  feeLamports: bigint;
  /** `balance − fees`: what Max sends, as the amount step shows it. */
  maxLamports: bigint;
  /** The rent-exempt minimum of the chain, for the rules the Custom input shows. */
  rentMinLamports: bigint;
};

export type WithdrawCheck =
  | WithdrawOkCheck
  | { status: "nothing_to_withdraw" | "balance_unavailable"; detail: WalletDetailData }
  | { status: "not_found" };

/**
 * The quote of the confirmation screen, or the rule of §9.5 the amount breaks — with the
 * check it was made on, so the amount step can be shown again without another read.
 */
export type WithdrawQuote =
  | { status: "ok"; check: WithdrawOkCheck; quote: TransferQuote }
  | { status: "refused"; check: WithdrawOkCheck; failure: TxFailure }
  | Exclude<WithdrawCheck, WithdrawOkCheck>;

/** What a Confirm ends as. `failed` covers an outcome still unknown: the row stays PENDING. */
export type WithdrawOutcome =
  | { status: "sent"; withdrawal: Withdrawal }
  | { status: "failed"; wallet: WalletSummary; withdrawal: Withdrawal; failure: TxFailure }
  | { status: "refused"; failure: TxFailure }
  | { status: "in_progress" }
  | { status: "not_found" };

/** The transfer helpers of V1-13 (`createTransferApi` of @launchbot/solana), handed in. */
export type { TransferApi };

export type WithdrawalsDeps = {
  prisma: PrismaClient;
  balances: Pick<BalancesService, "getUserBalances" | "invalidateUserBalances">;
  transfer: TransferApi;
  /** The one vault of the process: the key is decrypted inside `send`, to sign, nowhere else. */
  vault: KeyVault;
  /** `getWithdrawFeeBudgetLamports(env.PRIORITY_FEE_MAX_MICROLAMPORTS)`: the V1-11 threshold. */
  withdrawFeeBudgetLamports: bigint;
  now?: () => number;
};

export type WithdrawalService = {
  /**
   * A click on Withdraw (§9.5): the wallet must be the user's, its balance read this very
   * moment, and above the fees of a transfer. Not the Refresh: no throttle, no cache.
   */
  check: (userId: string, walletId: string) => Promise<WithdrawCheck>;
  /**
   * The amount resolved on a fresh balance, then the quote of V1-13: fees estimated on the
   * real transaction, rules of §9.5 applied. Nothing is signed.
   */
  quote: (
    userId: string,
    walletId: string,
    to: string,
    amount: WithdrawAmount,
  ) => Promise<WithdrawQuote>;
  /**
   * The withdrawal itself (§13): V1-13 quotes on a fresh balance, the row is recorded PENDING
   * from that quote before the broadcast, then CONFIRMED or FAILED. An attempt whose outcome
   * the RPC could not give stays PENDING with its signature, for `resolve`. A wallet with an
   * attempt still in flight refuses another one — the lock that survives a restart. `kind`
   * marks the funding of a launch wallet (decision of 26/09/2026), which takes the same road.
   */
  execute: (
    userId: string,
    walletId: string,
    to: string,
    amount: SendAmount,
    options?: { kind?: "USER" | "LAUNCH_FUNDING" },
  ) => Promise<WithdrawOutcome>;
  /**
   * The latest attempt of the wallet that was still PENDING, brought up to date from the chain;
   * `null` when none is in flight. Before a Try again, and before a Confirm.
   */
  resolve: (userId: string, walletId: string) => Promise<Withdrawal | null>;
};

const failed = (value: TransferQuote | TxSuccess | TxFailure): value is TxFailure =>
  "ok" in value && value.ok === false;

/** `Withdrawal.error`: the code, then the short program detail of V1-13. Never a secret. */
export const errorText = (code: string, detail?: string): string =>
  `${code}${detail === undefined ? "" : `: ${detail}`}`.slice(0, WITHDRAWAL_ERROR_MAX_CHARS);

/**
 * The key columns leave the database into `send` only, which decrypts them to sign (§9.6): the
 * withdrawal and the payment of an invoice from a wallet (V1-31).
 */
export const WALLET_SIGNER_SELECT = {
  ...WALLET_SUMMARY_SELECT,
  encSecretKey: true,
  iv: true,
  authTag: true,
} as const;

/**
 * A send whose outcome was unknown can still land while it sits in a block, while the RPC does
 * not answer, or while it is younger than the in-flight window: a blockhash lives about a
 * minute, so past the window it never will. Nothing is signed over it until then.
 */
export const mayStillLand = (outcome: SignatureOutcome, ageMs: number): boolean =>
  outcome.status === "processed" ||
  outcome.status === "unavailable" ||
  (outcome.status === "not_found" && ageMs < WITHDRAWAL_IN_FLIGHT_MS);

/** What the chain says of a transfer still PENDING (§13). Nothing is written: the caller does. */
export type Settlement =
  | { status: "in_flight" }
  | { status: "landed"; signature: string; slot: number }
  | { status: "failed"; error: string };

const IN_FLIGHT: Settlement = { status: "in_flight" };

/**
 * A PENDING `Withdrawal` against the chain: the withdrawal (V1-14) and the treasury (V1-33)
 * settle their rows by the same rules, then record the result their own way.
 */
export async function settleTransfer(
  lookup: TransferApi["lookup"],
  row: Pick<Withdrawal, "signature" | "createdAt">,
  nowMs: number,
): Promise<Settlement> {
  const ageMs = nowMs - row.createdAt.getTime();
  const { signature } = row;
  if (signature === null) {
    // Being signed, or recorded and never broadcast (the process stopped between the two).
    return ageMs < WITHDRAWAL_IN_FLIGHT_MS ? IN_FLIGHT : { status: "failed", error: "NEVER_SENT" };
  }
  const outcome = await lookup(signature);
  if (outcome.status === "confirmed") return { status: "landed", signature, slot: outcome.slot };
  if (outcome.status === "failed") {
    return { status: "failed", error: errorText("TRANSACTION_REJECTED", outcome.detail) };
  }
  return mayStillLand(outcome, ageMs)
    ? IN_FLIGHT
    : { status: "failed", error: "BLOCKHASH_EXPIRED" };
}

/** The columns a confirmed transfer writes: `max` is recomputed at the send, what moved. */
export type ConfirmedTransfer = {
  status: "CONFIRMED";
  signature: string;
  feeLamports: bigint;
  lamports: bigint;
};

export type RecordedSend =
  /** Refused at the quote: nothing was written, nothing was sent. */
  | { status: "refused"; failure: TxFailure }
  /** The row is still PENDING: the caller writes `confirmed`, with what it records beside it. */
  | {
      status: "sent";
      row: Withdrawal;
      quote: TransferQuote;
      slot: number;
      confirmed: ConfirmedTransfer;
    }
  /** Written FAILED, or kept PENDING with its signature when the outcome is unknown. */
  | { status: "failed"; row: Withdrawal; failure: TxFailure };

/**
 * A transfer recorded as a `Withdrawal` (§13): the row from the one fresh quote of V1-13, before
 * anything is signed, and its signature on file before the confirmation — whatever happens next,
 * an outcome the RPC could not give is looked up, never sent again.
 */
export async function sendRecorded(
  deps: { prisma: PrismaClient; send: TransferApi["send"] },
  request: TransferRequest,
  signer: SignerSource,
  record: Pick<
    Prisma.WithdrawalUncheckedCreateInput,
    "userId" | "walletId" | "kind" | "createdAt" | "userTelegramId"
  >,
): Promise<RecordedSend> {
  const { prisma, send } = deps;
  let row: Withdrawal | undefined;
  let quote: TransferQuote | undefined;
  const result = await send(request, signer, {
    onPrepared: async (prepared) => {
      quote = prepared;
      row = await prisma.withdrawal.create({
        data: {
          ...record,
          fromAddress: request.from,
          toAddress: request.to,
          lamports: prepared.amountLamports,
          feeLamports: prepared.fee.totalFeeLamports,
        },
      });
    },
    onSubmitted: async (signature) => {
      if (row !== undefined) {
        await prisma.withdrawal.update({ where: { id: row.id }, data: { signature } });
      }
    },
  });

  if (row === undefined || quote === undefined) {
    if (result.ok) throw new Error("A transfer was sent without its quote");
    return { status: "refused", failure: result };
  }
  if (result.ok) {
    const confirmed: ConfirmedTransfer = {
      status: "CONFIRMED",
      signature: result.signature,
      feeLamports: result.feeLamports,
      lamports: result.amountLamports ?? row.lamports,
    };
    return { status: "sent", row, quote, slot: result.slot, confirmed };
  }
  // A signature `onSubmitted` wrote stays: a broadcast that never landed is still a fact. An
  // unknown outcome keeps the row PENDING (proposal): the next attempt reads the chain first.
  const failedRow = await prisma.withdrawal.update({
    where: { id: row.id },
    data: {
      ...(result.signature === undefined ? {} : { signature: result.signature }),
      ...(result.landed === "unknown"
        ? {}
        : { status: "FAILED", error: errorText(result.code, result.detail) }),
    },
  });
  return { status: "failed", row: failedRow, failure: result };
}

export function createWithdrawalService(deps: WithdrawalsDeps): WithdrawalService {
  const { prisma, balances, transfer, vault, withdrawFeeBudgetLamports, now = Date.now } = deps;

  const isStale = (row: Withdrawal): boolean =>
    now() - row.createdAt.getTime() >= WITHDRAWAL_IN_FLIGHT_MS;

  const update = (id: string, data: Parameters<typeof prisma.withdrawal.update>[0]["data"]) =>
    prisma.withdrawal.update({ where: { id }, data });

  /** A PENDING row brought up to date from the chain (§13). Fees paid mean balances moved. */
  async function settle(row: Withdrawal, userId: string): Promise<Withdrawal> {
    const settled = await settleTransfer(transfer.lookup, row, now());
    if (settled.status === "in_flight") return row;
    if (settled.status === "failed") {
      const withdrawal = await update(row.id, { status: "FAILED", error: settled.error });
      if (row.signature !== null) balances.invalidateUserBalances(userId);
      return withdrawal;
    }
    const withdrawal = await update(row.id, { status: "CONFIRMED" });
    balances.invalidateUserBalances(userId);
    log.info({ withdrawalId: row.id, slot: settled.slot }, "withdrawal.confirmed.late");
    return withdrawal;
  }

  async function check(userId: string, walletId: string): Promise<WithdrawCheck> {
    const fresh = await readFreshWallet(balances, userId, walletId);
    if (fresh.status !== "fresh") return fresh;
    const { detail, lamports } = fresh;
    if (!isBalanceWithdrawable(lamports, withdrawFeeBudgetLamports)) {
      return { status: "nothing_to_withdraw", detail };
    }
    const [feeLamports, rentMinLamports] = await Promise.all([
      transfer.estimateFee(detail.wallet.publicKey),
      transfer.rentMin(),
    ]);
    return {
      status: "ok",
      detail,
      lamports,
      feeLamports,
      maxLamports: computeMaxAmount(lamports, feeLamports),
      rentMinLamports,
    };
  }

  return {
    check,

    async quote(userId, walletId, to, amount) {
      const checked = await check(userId, walletId);
      if (checked.status !== "ok") return checked;
      const result = await transfer.prepare({
        from: checked.detail.wallet.publicKey,
        to,
        amount: resolveWithdrawAmount(checked.lamports, amount),
      });
      return failed(result)
        ? { status: "refused", check: checked, failure: result }
        : { status: "ok", check: checked, quote: result };
    },

    async execute(userId, walletId, to, amount, { kind = "USER" } = {}) {
      const [wallet, pending] = await Promise.all([
        prisma.wallet.findFirst({
          where: { id: walletId, userId, ...MANAGED_WALLET },
          select: WALLET_SIGNER_SELECT,
        }),
        prisma.withdrawal.findFirst({
          where: { walletId, status: "PENDING" },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      if (wallet === null) return { status: "not_found" };
      // In flight, or left behind by a restart or an unknown confirmation and settled first.
      if (
        pending !== null &&
        (!isStale(pending) || (await settle(pending, userId)).status === "PENDING")
      ) {
        return { status: "in_progress" };
      }

      const { encSecretKey, iv, authTag, ...summary } = wallet;
      const from = summary.publicKey;
      const sent = await sendRecorded(
        { prisma, send: transfer.send },
        // In `max` mode the amount is whatever V1-13 quotes: the field is not read. In `debit`
        // mode it is the total that leaves the wallet, fees included.
        {
          from,
          to,
          mode: amount.kind,
          amountLamports: amount.kind === "max" ? 0n : amount.lamports,
        },
        { kind: "vault", vault, enc: { encSecretKey, iv, authTag }, address: from },
        { userId, walletId, kind },
      );
      if (sent.status === "refused") return sent;
      const { row } = sent;
      if (sent.status === "sent") {
        const withdrawal = await update(row.id, sent.confirmed);
        balances.invalidateUserBalances(userId);
        log.info(
          { userId, walletId, withdrawalId: row.id, slot: sent.slot },
          "withdrawal.confirmed",
        );
        return { status: "sent", withdrawal };
      }
      const { failure } = sent;
      // Landed and failed: the fees were paid, the balances moved.
      if (failure.landed === "yes") balances.invalidateUserBalances(userId);
      log.warn({ userId, walletId, withdrawalId: row.id, code: failure.code }, "withdrawal.failed");
      return { status: "failed", wallet: summary, withdrawal: row, failure };
    },

    async resolve(userId, walletId) {
      const pending = await prisma.withdrawal.findFirst({
        where: { walletId, userId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      return pending === null ? null : settle(pending, userId);
    },
  };
}
