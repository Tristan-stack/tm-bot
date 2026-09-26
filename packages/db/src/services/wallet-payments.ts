import {
  MINUTE_MS,
  transferShortfall,
  TX_CONFIRM_TIMEOUT_MS,
  TX_MAX_ATTEMPTS,
} from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { KeyVault, TxFailure, TxSuccess } from "@launchbot/solana";
import { tryLockScope } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { MANAGED_WALLET } from "./balances.js";
import type { BalancesService, WalletBalance } from "./balances.js";
import { isAwaitingPayment } from "./payments.js";
import type { AwaitingCheck, InvoiceCheck, InvoiceView, PaymentService } from "./payments.js";
import { mayStillLand, WALLET_SIGNER_SELECT } from "./withdrawals.js";
import type { TransferApi } from "./withdrawals.js";

const log = createLogger("db:wallet-payments");

/** The lock of a payment outlives the longest send of V1-13: every attempt, confirmed or not. */
const PAY_LOCK_TIMEOUT_MS = TX_MAX_ATTEMPTS * TX_CONFIRM_TIMEOUT_MS + MINUTE_MS;

/**
 * A wallet facing the rest of an invoice. `missingLamports`: 0 when it can pay, `null` when its
 * balance is unknown.
 */
export type PayChoice = { wallet: WalletBalance; missingLamports: bigint | null };

/** The invoice as a wallet pays it: the rest to send and the fees of a transfer now, once per screen. */
export type PayChoices = { invoice: InvoiceView; feeLamports: bigint; wallets: PayChoice[] };

/** A wallet that can pay the rest of the invoice: the confirmation screen (§8.3). */
export type PayQuote = { invoice: InvoiceView; feeLamports: bigint; wallet: WalletBalance };

/** What a Confirm sends: the rest the confirmation showed, which must still be the rest. */
export type PayRequest = { paymentId: string; walletId: string; amountLamports: bigint };

/** The invoice can no longer be paid from here: the check says what it became (V1-30 shows it). */
type Blocked = { status: "blocked"; check: InvoiceCheck };

/** A wallet that cannot pay, with the list to draw again at the same fee: nothing is read twice. */
export type PayRefusal = PayChoices &
  (
    | { status: "insufficient"; wallet: WalletBalance; missingLamports: bigint }
    | { status: "wallet_not_found" | "balance_unavailable" }
  );

export type PayChoicesResult = ({ status: "ok" } & PayChoices) | Blocked;

export type PayQuoteResult = ({ status: "ok" } & PayQuote) | PayRefusal | Blocked;

export type PayOutcome =
  /** Sent and confirmed; `check` says whether the invoice activated (§8.3, V1-32). */
  | { status: "sent"; check: InvoiceCheck }
  /** Broadcast, outcome unknown: never sent again until the chain says (proposal). */
  | { status: "unconfirmed"; signature?: string; check: AwaitingCheck }
  | { status: "failed"; failure: TxFailure; wallet: WalletBalance }
  /** Something arrived meanwhile: the confirmation again, nothing sent. */
  | ({ status: "amount_changed" } & PayQuote)
  | { status: "locked" }
  | PayRefusal
  | Blocked;

/** A send whose outcome was unknown, as the bot keeps it (session): read before any new send. */
export type PayInFlight = { signature: string; sentAt: number };

export type PayOptions = {
  inFlight?: PayInFlight;
  /** Called once V1-13 has read the wallet and priced the send, right before it signs. */
  onSending?: (quote: PayQuote) => Promise<unknown>;
};

export type WalletPaymentService = {
  /** The choice (§8.3): every wallet of the user at its cached balance (30 s, V1-07). */
  listChoices: (userId: string, paymentId: string) => Promise<PayChoicesResult>;
  /** A click on a wallet: the balances read this very moment, then the confirmation or what it lacks. */
  quote: (userId: string, paymentId: string, walletId: string) => Promise<PayQuoteResult>;
  /**
   * Confirm (§8.3): under a lock per invoice, the deposit read again (a covered invoice
   * activates, nothing is sent), then the rest sent from the wallet to the deposit address of
   * the table — V1-13 reads the balance and the fees again and refuses what no longer passes.
   * The invoice is checked once the lock is released.
   */
  pay: (userId: string, request: PayRequest, options?: PayOptions) => Promise<PayOutcome>;
};

export type WalletPaymentsDeps = {
  prisma: PrismaClient;
  payments: Pick<PaymentService, "getInvoice" | "checkInvoice">;
  balances: Pick<BalancesService, "getUserBalances" | "invalidateUserBalances">;
  transfer: TransferApi;
  /** The one vault of the process: the key is decrypted inside `send`, to sign, nowhere else. */
  vault: KeyVault;
  now?: () => Date;
};

/** A send that went through the checks, with what V1-13 answered. */
type Attempted = {
  status: "attempted";
  before: AwaitingCheck;
  /** Its balance as V1-13 read it before signing; `null` when it refused before reading. */
  wallet: WalletBalance;
  result: TxSuccess | TxFailure;
};

/** Refused by V1-13 before anything was signed: the balance no longer covers the rest. */
const isShortOfFunds = (result: TxSuccess | TxFailure): boolean =>
  !result.ok &&
  result.landed === "no" &&
  (result.code === "INSUFFICIENT_FUNDS" || result.code === "REMAINING_BELOW_RENT");

export function createWalletPaymentService(deps: WalletPaymentsDeps): WalletPaymentService {
  const { prisma, payments, balances, transfer, vault, now = () => new Date() } = deps;

  /** The invoice still open to a payment, from the table; any other one through a check. */
  async function openInvoice(
    userId: string,
    paymentId: string,
  ): Promise<{ status: "open"; invoice: InvoiceView } | Blocked> {
    const at = now();
    const invoice = await payments.getInvoice(paymentId, userId, at);
    if (invoice === null) return { status: "blocked", check: { kind: "NOT_FOUND", checkedAt: at } };
    if (invoice.status === "PENDING" && invoice.remainingLamports > 0n) {
      return { status: "open", invoice };
    }
    return {
      status: "blocked",
      check: await payments.checkInvoice(paymentId, { now: at, userId }),
    };
  }

  /**
   * Every wallet against the rest of the invoice, on the rules of §9.5 (`transferShortfall`).
   * One fee estimate for the screen, on the deposit address every payer writes to.
   */
  async function choicesOf(
    userId: string,
    invoice: InvoiceView,
    skipCache: boolean,
  ): Promise<{ choices: PayChoices; fresh: boolean }> {
    const [read, feeLamports, rentMin] = await Promise.all([
      balances.getUserBalances(userId, { skipCache }),
      transfer.estimateFee(invoice.depositAddress),
      transfer.rentMin(),
    ]);
    const amount = invoice.remainingLamports;
    const wallets = read.wallets.map((wallet) => ({
      wallet,
      missingLamports:
        wallet.lamports === null
          ? null
          : transferShortfall({ balance: wallet.lamports, amount, fee: feeLamports, rentMin }),
    }));
    return { choices: { invoice, feeLamports, wallets }, fresh: read.status === "fresh" };
  }

  /**
   * A wallet read this very moment: the confirmation, or why it cannot pay. Money moves on a
   * balance of now only: a stale one is no answer.
   */
  async function quoteFresh(
    userId: string,
    invoice: InvoiceView,
    walletId: string,
  ): Promise<Exclude<PayQuoteResult, Blocked>> {
    const { choices, fresh } = await choicesOf(userId, invoice, true);
    const choice = choices.wallets.find((candidate) => candidate.wallet.id === walletId);
    if (choice === undefined) return { status: "wallet_not_found", ...choices };
    const { wallet, missingLamports } = choice;
    if (!fresh || missingLamports === null) return { status: "balance_unavailable", ...choices };
    if (missingLamports > 0n) {
      return { status: "insufficient", ...choices, wallet, missingLamports };
    }
    return { status: "ok", invoice, feeLamports: choices.feeLamports, wallet };
  }

  /**
   * One payment at a time per invoice, across processes: a transaction holds the advisory lock
   * for as long as the send runs, and releases it however it ends (proposal: the transaction
   * variant, since Prisma pools its connections). `null` when another payment holds it.
   */
  async function withPayLock<T>(paymentId: string, work: () => Promise<T>): Promise<T | null> {
    const box: { result?: { value: T } } = {};
    try {
      await prisma.$transaction(
        async (tx) => {
          if (!(await tryLockScope(tx, "pay", paymentId))) return;
          box.result = { value: await work() };
        },
        { timeout: PAY_LOCK_TIMEOUT_MS },
      );
    } catch (error) {
      // A send that outlived the transaction lost its lock, never its outcome.
      if (box.result === undefined) throw error;
      log.warn({ err: error, paymentId }, "payment.wallet_lock_lost");
    }
    return box.result === undefined ? null : box.result.value;
  }

  /** What the lock covers: the checks, then the send. */
  async function attempt(
    userId: string,
    request: PayRequest,
    options: PayOptions,
  ): Promise<PayOutcome | Attempted> {
    const { paymentId, walletId, amountLamports } = request;
    const { inFlight } = options;
    // Read before the deposit: a send that confirms in between is then counted by it.
    const pending =
      inFlight !== undefined &&
      mayStillLand(await transfer.lookup(inFlight.signature), now().getTime() - inFlight.sentAt);
    const check = await payments.checkInvoice(paymentId, { now: now(), userId });
    // Paid (maybe by this very check), expired, canceled or gone: nothing is sent.
    if (!isAwaitingPayment(check)) return { status: "blocked", check };
    if (pending) return { status: "unconfirmed", signature: inFlight?.signature, check };

    const { invoice } = check;
    if (invoice.remainingLamports !== amountLamports) {
      const quote = await quoteFresh(userId, invoice, walletId);
      return quote.status === "ok" ? { ...quote, status: "amount_changed" } : quote;
    }
    const row = await prisma.wallet.findFirst({
      where: { id: walletId, userId, ...MANAGED_WALLET },
      select: WALLET_SIGNER_SELECT,
    });
    if (row === null) {
      const { choices } = await choicesOf(userId, invoice, false);
      return { status: "wallet_not_found", ...choices };
    }

    const { encSecretKey, iv, authTag, ...summary } = row;
    const wallet: WalletBalance = { ...summary, lamports: null };
    const result = await transfer.send(
      // The destination is the deposit address of the table, never a user input (§9.6).
      { from: wallet.publicKey, to: invoice.depositAddress, mode: "exact", amountLamports },
      { kind: "vault", vault, enc: { encSecretKey, iv, authTag }, address: wallet.publicKey },
      {
        onPrepared: async (quote) => {
          wallet.lamports = quote.balanceLamports;
          await options.onSending?.({ invoice, feeLamports: quote.fee.totalFeeLamports, wallet });
        },
      },
    );
    return { status: "attempted", before: check, wallet, result };
  }

  /** After the lock: the deposit decides (§8.3), what arrived activates whatever the send said. */
  async function conclude(userId: string, attempted: Attempted): Promise<PayOutcome> {
    const { before, wallet, result } = attempted;
    const { invoice } = before;
    const ids = { paymentId: invoice.id, walletId: wallet.id };
    if (result.ok) {
      log.info(
        {
          ...ids,
          lamports: invoice.remainingLamports.toString(),
          feeLamports: result.feeLamports.toString(),
          signature: result.signature,
        },
        "payment.wallet_sent",
      );
    } else {
      log.warn({ ...ids, code: result.code, landed: result.landed }, "payment.wallet_failed");
    }
    if (isShortOfFunds(result)) {
      // The balance moved since the confirmation: the list, with what the wallet lacks now.
      const quote = await quoteFresh(userId, invoice, wallet.id);
      if (quote.status !== "ok") return quote;
    }
    if (result.ok || result.landed !== "no") balances.invalidateUserBalances(userId);

    let check: InvoiceCheck = before;
    try {
      check = await payments.checkInvoice(invoice.id, { now: now(), userId });
    } catch (error) {
      log.warn({ err: error, paymentId: invoice.id }, "payment.wallet_check_failed");
    }
    if (result.ok || check.kind === "ACTIVATED") return { status: "sent", check };
    if (result.landed === "unknown") {
      return {
        status: "unconfirmed",
        signature: result.signature,
        check: isAwaitingPayment(check) ? check : before,
      };
    }
    return { status: "failed", failure: result, wallet };
  }

  return {
    async listChoices(userId, paymentId) {
      const opened = await openInvoice(userId, paymentId);
      if (opened.status === "blocked") return opened;
      const { choices } = await choicesOf(userId, opened.invoice, false);
      return { status: "ok", ...choices };
    },

    async quote(userId, paymentId, walletId) {
      const opened = await openInvoice(userId, paymentId);
      if (opened.status === "blocked") return opened;
      return quoteFresh(userId, opened.invoice, walletId);
    },

    async pay(userId, request, options = {}) {
      const outcome = await withPayLock(request.paymentId, () => attempt(userId, request, options));
      if (outcome === null) return { status: "locked" };
      return outcome.status === "attempted" ? conclude(userId, outcome) : outcome;
    },
  };
}
