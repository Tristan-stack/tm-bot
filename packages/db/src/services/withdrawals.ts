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
  TransferQuote,
  TransferRequest,
  TxFailure,
  TxSuccess,
} from "@launchbot/solana";
import type { PrismaClient, Withdrawal } from "../generated/prisma/client.js";
import { readFreshWallet, WALLET_SUMMARY_SELECT } from "./balances.js";
import type { BalancesService, WalletDetailData } from "./balances.js";
import type { WalletSummary } from "./wallets.js";

const log = createLogger("db:withdrawals");

/** What the amount step offers (§9.5): a share of the balance, the whole of it, or a number. */
export type WithdrawAmount =
  { kind: "pct"; pct: WithdrawalPresetPct } | { kind: "max" } | { kind: "exact"; lamports: bigint };
/** What is sent: a share has been resolved to a number by then. */
export type WithdrawRequest = Exclude<WithdrawAmount, { kind: "pct" }>;

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

/**
 * The transaction helpers of @launchbot/solana (V1-13), bound to the context of the process:
 * this package does not load that package, it is handed what it needs.
 */
export type TransferApi = {
  estimateFee: (from: string) => Promise<bigint>;
  rentMin: () => Promise<bigint>;
  prepare: (params: {
    from: string;
    to: string;
    amount: bigint | "max";
  }) => Promise<TransferQuote | TxFailure>;
  send: (
    request: TransferRequest,
    signer: SignerSource,
    options: {
      onPrepared: (quote: TransferQuote) => Promise<void>;
      onSubmitted: (signature: string) => Promise<void>;
    },
  ) => Promise<TxSuccess | TxFailure>;
  lookup: (signature: string) => Promise<SignatureOutcome>;
};

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
   * attempt still in flight refuses another one — the lock that survives a restart.
   */
  execute: (
    userId: string,
    walletId: string,
    to: string,
    amount: WithdrawRequest,
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
const errorText = (code: string, detail?: string): string =>
  `${code}${detail === undefined ? "" : `: ${detail}`}`.slice(0, WITHDRAWAL_ERROR_MAX_CHARS);

/** The key columns leave the database into `send` only, which decrypts them to sign (§9.6). */
const WALLET_SIGNER_SELECT = {
  ...WALLET_SUMMARY_SELECT,
  encSecretKey: true,
  iv: true,
  authTag: true,
} as const;

export function createWithdrawalService(deps: WithdrawalsDeps): WithdrawalService {
  const { prisma, balances, transfer, vault, withdrawFeeBudgetLamports, now = Date.now } = deps;

  const isStale = (row: Withdrawal): boolean =>
    now() - row.createdAt.getTime() >= WITHDRAWAL_IN_FLIGHT_MS;

  const update = (id: string, data: Parameters<typeof prisma.withdrawal.update>[0]["data"]) =>
    prisma.withdrawal.update({ where: { id }, data });

  /** A PENDING row brought up to date from the chain (§13). Fees paid mean balances moved. */
  async function settle(row: Withdrawal, userId: string): Promise<Withdrawal> {
    if (row.signature === null) {
      // Never broadcast: the process stopped between the row and the send.
      return isStale(row) ? update(row.id, { status: "FAILED", error: "NEVER_SENT" }) : row;
    }
    const outcome = await transfer.lookup(row.signature);
    switch (outcome.status) {
      case "confirmed": {
        const withdrawal = await update(row.id, { status: "CONFIRMED" });
        balances.invalidateUserBalances(userId);
        log.info({ withdrawalId: row.id, slot: outcome.slot }, "withdrawal.confirmed.late");
        return withdrawal;
      }
      case "failed": {
        const withdrawal = await update(row.id, {
          status: "FAILED",
          error: errorText("TRANSACTION_REJECTED", outcome.detail),
        });
        balances.invalidateUserBalances(userId);
        return withdrawal;
      }
      case "not_found":
        // A blockhash lives about a minute: past the in-flight window, it will never land.
        return isStale(row)
          ? update(row.id, { status: "FAILED", error: "BLOCKHASH_EXPIRED" })
          : row;
      case "processed":
      case "unavailable":
        // Still in a block, or no answer: nothing is decided, nothing is signed over it.
        return row;
    }
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

    async execute(userId, walletId, to, amount) {
      const [wallet, pending] = await Promise.all([
        prisma.wallet.findFirst({ where: { id: walletId, userId }, select: WALLET_SIGNER_SELECT }),
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
      let row: Withdrawal | undefined;
      const result = await transfer.send(
        // In `max` mode the amount is whatever V1-13 quotes: the field is not read.
        {
          from,
          to,
          mode: amount.kind,
          amountLamports: amount.kind === "max" ? 0n : amount.lamports,
        },
        { kind: "vault", vault, enc: { encSecretKey, iv, authTag }, address: from },
        {
          // Recorded from the one fresh quote of V1-13, before anything is signed.
          onPrepared: async (quote) => {
            row = await prisma.withdrawal.create({
              data: {
                userId,
                walletId,
                fromAddress: from,
                toAddress: to,
                lamports: quote.amountLamports,
                feeLamports: quote.fee.totalFeeLamports,
                kind: "USER",
              },
            });
          },
          // Written before the confirmation: whatever happens next, the signature is on file.
          onSubmitted: async (signature) => {
            if (row !== undefined) await update(row.id, { signature });
          },
        },
      );

      if (row === undefined) {
        // Refused at the quote: nothing was written, nothing was sent.
        if (result.ok) throw new Error("A transfer was sent without its quote");
        return { status: "refused", failure: result };
      }
      if (result.ok) {
        const withdrawal = await update(row.id, {
          status: "CONFIRMED",
          signature: result.signature,
          feeLamports: result.feeLamports,
          // Max is recomputed at the send: what moved, not what was quoted.
          lamports: result.amountLamports ?? row.lamports,
        });
        balances.invalidateUserBalances(userId);
        log.info(
          { userId, walletId, withdrawalId: row.id, slot: result.slot },
          "withdrawal.confirmed",
        );
        return { status: "sent", withdrawal };
      }
      // A signature `onSubmitted` wrote stays: a broadcast that never landed is still a fact.
      // An unknown outcome keeps the row PENDING (proposal): `resolve` reads the chain later.
      const withdrawal = await update(row.id, {
        ...(result.signature === undefined ? {} : { signature: result.signature }),
        ...(result.landed === "unknown"
          ? {}
          : { status: "FAILED", error: errorText(result.code, result.detail) }),
      });
      // Landed and failed: the fees were paid, the balances moved.
      if (result.landed === "yes") balances.invalidateUserBalances(userId);
      log.warn({ userId, walletId, withdrawalId: row.id, code: result.code }, "withdrawal.failed");
      return { status: "failed", wallet: summary, withdrawal, failure: result };
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
