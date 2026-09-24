import {
  chunk,
  computeExpectedLamports,
  decideInvoice,
  decidePurchase,
  effectiveStatus,
  formatSolUsdRate,
  getOffer,
  idSchema,
  INVOICE_TTL_MS,
  isPaid,
  LATE_PAYMENT_TOLERANCE_MS,
  MAX_ACCOUNTS_PER_READ,
  RATE_LIMITS,
} from "@launchbot/shared";
import type { InvoiceReportKind, Offer } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { GeneratedKeypair, KeyVault } from "@launchbot/solana";
import { lockUserScope } from "../client.js";
import type { Db } from "../client.js";
import type { Payment, PaymentStatus, Plan, PrismaClient } from "../generated/prisma/client.js";
import { getActiveSubscription, getPlanStatus } from "./subscriptions.js";
import type { SubscriptionService } from "./subscriptions.js";

const log = createLogger("db:payments");

/** An invoice as every caller reads it: the deposit key never leaves the table (§9.6). */
export type InvoiceRow = Omit<Payment, "encSecretKey" | "iv" | "authTag">;
export const WITHOUT_KEY = { encSecretKey: true, iv: true, authTag: true } as const;

/** What the invoice screens show (V1-30, V1-31). No key material, ever. */
export type InvoiceView = {
  id: string;
  /** `null` once the account was purged: the invoice stays, detached (§13). */
  userId: string | null;
  offer: Offer;
  /** `59.00`: the price of the invoice, never recomputed at the current rate. */
  priceUsd: string;
  solUsdRate: string;
  expectedLamports: bigint;
  receivedLamports: bigint;
  /** What is still to send; 0 once the amount is reached. */
  remainingLamports: bigint;
  depositAddress: string;
  status: PaymentStatus;
  expiresAt: Date;
  /** 0 once expired: « expires in mm:ss » at the time of the render. */
  secondsLeft: number;
};

export type CreateInvoiceResult =
  | { ok: true; invoice: InvoiceView; reused: boolean }
  | { ok: false; error: "PRICE_UNAVAILABLE" | "PLAN_SWITCH_REFUSED" | "RATE_LIMITED" };

type Viewed = { invoice: InvoiceView; checkedAt: Date };

/** The outcome of a check (§8.3), each with `checkedAt` for « last check 14:32 UTC » (V1-30). */
export type InvoiceCheck =
  | ({ kind: InvoiceReportKind | "ORPHAN_PAYMENT" } & Viewed)
  | ({
      kind: "ACTIVATED";
      /** Only the process that activated says so: it alone sends « Payment received » (V1-32). */
      activatedNow: boolean;
      plan: Plan;
      expiresAt: Date;
    } & Viewed)
  | { kind: "NOT_FOUND"; checkedAt: Date };

/** An invoice still waiting for its money: the screen of V1-30 stays, a wallet can pay it (V1-31). */
export type AwaitingCheck = { kind: "NOT_DETECTED" | "PARTIAL" } & Viewed;

export const isAwaitingPayment = (check: InvoiceCheck): check is AwaitingCheck =>
  check.kind === "NOT_DETECTED" || check.kind === "PARTIAL";

export type CancelResult = "CANCELED" | "ALREADY_PAID" | "NOOP" | "NOT_FOUND";

export type PaymentsDeps = {
  prisma: PrismaClient;
  subscriptions: Pick<SubscriptionService, "activateFromPayment">;
  /** The SOL/USD of V1-07: cached 60 s, the last price for 10 minutes, then `null`. */
  getSolUsdPrice: () => Promise<number | null>;
  /**
   * Balances at `confirmed`, without the 30 s cache of the screens: `getBalancesFresh` on the
   * connection of the process. Called with at most 100 addresses; an address never funded is 0.
   */
  readLamports: (addresses: readonly string[]) => Promise<Map<string, bigint>>;
  /** A fresh keypair per invoice (V1-09), encrypted at once: nothing here ever decrypts it. */
  generateKeypair: () => GeneratedKeypair;
  vault: Pick<KeyVault, "encrypt">;
};

export type PaymentService = {
  /**
   * An invoice for `offer` (§8.3): rules of V1-27 first, then the price of the moment frozen
   * 30 minutes, a new deposit address. A pending invoice of the same offer is handed back
   * instead (`reused`, proposal validated on 24/09/2026).
   */
  createInvoice: (input: {
    userId: string;
    offer: Offer;
    now: Date;
  }) => Promise<CreateInvoiceResult>;
  /** The invoice of this user, or `null` (unknown, someone else's). */
  getInvoice: (paymentId: string, userId: string, now: Date) => Promise<InvoiceView | null>;
  /** « I've paid » (V1-30), and after a payment from a bot wallet (V1-31): one fresh read. */
  checkInvoice: (
    paymentId: string,
    options: { now: Date; userId?: string },
  ) => Promise<InvoiceCheck>;
  /** The decision on a balance already read: the core of `checkInvoice` and of the batch. */
  checkInvoiceWithBalance: (
    payment: InvoiceRow,
    balanceLamports: bigint,
    now: Date,
  ) => Promise<InvoiceCheck>;
  /**
   * The worker's tick (V1-32): one grouped read per 100 addresses. A read that fails leaves its
   * invoices out of the map (checked again next tick); nothing is decided on an unread balance.
   */
  checkInvoicesBatch: (
    payments: readonly InvoiceRow[],
    now: Date,
  ) => Promise<Map<string, InvoiceCheck>>;
  /** PENDING, and EXPIRED or CANCELED within their 24 h: what can still activate. */
  listInvoicesToCheck: (now: Date) => Promise<InvoiceRow[]>;
  cancelInvoice: (paymentId: string, userId: string, now: Date) => Promise<CancelResult>;
  /** PENDING past their 30 minutes → EXPIRED; the number of rows changed. */
  expireDueInvoices: (now: Date) => Promise<number>;
};

export function invoiceViewOf(row: InvoiceRow, now: Date): InvoiceView {
  const remaining = row.expectedLamports - row.receivedLamports;
  return {
    id: row.id,
    userId: row.userId,
    offer: getOffer(row.plan, row.duration),
    priceUsd: row.priceUsd.toFixed(2),
    solUsdRate: row.solUsdRate.toFixed(),
    expectedLamports: row.expectedLamports,
    receivedLamports: row.receivedLamports,
    remainingLamports: remaining > 0n ? remaining : 0n,
    depositAddress: row.depositAddress,
    status: row.status,
    expiresAt: row.expiresAt,
    secondsLeft: Math.max(0, Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

const viewed = (row: InvoiceRow, now: Date): Viewed => ({
  invoice: invoiceViewOf(row, now),
  checkedAt: now,
});

async function recordReceived(db: Db, row: InvoiceRow, balance: bigint): Promise<InvoiceRow> {
  if (balance === row.receivedLamports) return row;
  await db.payment.update({ where: { id: row.id }, data: { receivedLamports: balance } });
  return { ...row, receivedLamports: balance };
}

export function createPaymentService(deps: PaymentsDeps): PaymentService {
  const { prisma, subscriptions, getSolUsdPrice, readLamports, generateKeypair, vault } = deps;

  const findOpenInvoice = (db: Db, userId: string, offer: Offer, now: Date) =>
    db.payment.findFirst({
      where: {
        userId,
        plan: offer.plan,
        duration: offer.duration,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      omit: WITHOUT_KEY,
    });

  /** `userId` given: the invoice must be this user's. An id that is not a cuid is no invoice. */
  async function find(paymentId: string, userId?: string): Promise<InvoiceRow | null> {
    if (!idSchema.safeParse(paymentId).success) return null;
    const row = await prisma.payment.findUnique({ where: { id: paymentId }, omit: WITHOUT_KEY });
    return row === null || (userId !== undefined && row.userId !== userId) ? null : row;
  }

  /** Lazy expiry (V1-28): the row catches up with its effective status, unless another write won. */
  async function expireIfDue(row: InvoiceRow, now: Date): Promise<InvoiceRow> {
    if (effectiveStatus(row, now) === row.status) return row;
    const { count } = await prisma.payment.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (count === 1) return { ...row, status: "EXPIRED" };
    return prisma.payment.findUniqueOrThrow({ where: { id: row.id }, omit: WITHOUT_KEY });
  }

  /**
   * A paid invoice shows the plan it paid for: the active one, or the last one once it ended
   * (a click on an old invoice). A purged account has no plan and no screen: NOT_FOUND.
   */
  async function paidOutcome(row: InvoiceRow, now: Date): Promise<InvoiceCheck> {
    const status = row.userId === null ? null : await getPlanStatus(prisma, row.userId, now);
    if (status === null || status.kind === "NONE") return { kind: "NOT_FOUND", checkedAt: now };
    const { plan, expiresAt } = status.subscription;
    return { kind: "ACTIVATED", activatedNow: false, plan, expiresAt, ...viewed(row, now) };
  }

  async function activate(row: InvoiceRow, balance: bigint, now: Date): Promise<InvoiceCheck> {
    // A purged account (§13): nothing can activate, so no transaction, even every 15 s.
    if (row.userId === null) {
      if (balance !== row.receivedLamports) log.info({ paymentId: row.id }, "payment.orphan");
      const recorded = await recordReceived(prisma, row, balance);
      return { kind: "ORPHAN_PAYMENT", ...viewed(recorded, now) };
    }
    // `receivedLamports` is written in the transaction of the activation (V1-27 takes `tx`).
    const result = await prisma.$transaction(async (tx) => {
      await recordReceived(tx, row, balance);
      return subscriptions.activateFromPayment(row.id, now, tx);
    });
    const paid: InvoiceRow = { ...row, status: "PAID", receivedLamports: balance };
    switch (result.status) {
      case "ACTIVATED": {
        const { plan, expiresAt } = result.subscription;
        return { kind: "ACTIVATED", activatedNow: true, plan, expiresAt, ...viewed(paid, now) };
      }
      case "ALREADY_ACTIVATED":
        return paidOutcome(paid, now);
      case "USER_DELETED":
        // Purged between the read of the invoice and its activation.
        return { kind: "ORPHAN_PAYMENT", ...viewed({ ...row, receivedLamports: balance }, now) };
    }
  }

  async function checkInvoiceWithBalance(
    payment: InvoiceRow,
    balance: bigint,
    now: Date,
  ): Promise<InvoiceCheck> {
    const decision = decideInvoice(payment, balance, now);
    if (decision.action === "ALREADY_PAID") return paidOutcome(payment, now);
    if (decision.action === "ACTIVATE") return activate(payment, balance, now);

    const received = balance !== payment.receivedLamports;
    const row = await recordReceived(prisma, await expireIfDue(payment, now), balance);
    if (isPaid(row.status)) return paidOutcome(row, now);
    // Logged when the funds move only: the worker checks these invoices every 15 s for 24 h.
    if (
      received &&
      (decision.kind === "LATE_FULL_PAYMENT" || decision.kind === "PARTIAL_EXPIRED")
    ) {
      log.info(
        { paymentId: row.id, userId: row.userId, receivedLamports: balance.toString() },
        `payment.${decision.kind.toLowerCase()}`,
      );
    }
    return { kind: decision.kind, ...viewed(row, now) };
  }

  return {
    async createInvoice({ userId, offer, now }) {
      // No price is needed to hand back an invoice already open.
      const [current, open] = await Promise.all([
        getActiveSubscription(prisma, userId, now),
        findOpenInvoice(prisma, userId, offer, now),
      ]);
      if (decidePurchase(current, offer.plan) === "REFUSED") {
        return { ok: false, error: "PLAN_SWITCH_REFUSED" };
      }
      if (open !== null) return { ok: true, invoice: invoiceViewOf(open, now), reused: true };

      const price = await getSolUsdPrice();
      if (price === null || !(price > 0)) return { ok: false, error: "PRICE_UNAVAILABLE" };
      const solUsdRate = formatSolUsdRate(price);
      const expectedLamports = computeExpectedLamports(offer.priceUsdCents, solUsdRate);

      // The key is generated and encrypted before the lock, and zeroed whatever happens.
      const key = generateKeypair();
      try {
        const encrypted = vault.encrypt(key.secretKey, key.address);
        return await prisma.$transaction(async (tx): Promise<CreateInvoiceResult> => {
          // One creation at a time per user: the reuse and the limit are checked under it.
          await lockUserScope(tx, "invoice", userId);
          const reused = await findOpenInvoice(tx, userId, offer, now);
          if (reused !== null)
            return { ok: true, invoice: invoiceViewOf(reused, now), reused: true };
          const { limit, windowMs } = RATE_LIMITS.invoice;
          const created = await tx.payment.count({
            where: { userId, createdAt: { gt: new Date(now.getTime() - windowMs) } },
          });
          if (created >= limit) return { ok: false, error: "RATE_LIMITED" };

          const row = await tx.payment.create({
            data: {
              userId,
              plan: offer.plan,
              duration: offer.duration,
              priceUsd: (offer.priceUsdCents / 100).toFixed(2),
              solUsdRate,
              expectedLamports,
              depositAddress: key.address,
              ...encrypted,
              expiresAt: new Date(now.getTime() + INVOICE_TTL_MS),
              createdAt: now,
            },
            omit: WITHOUT_KEY,
          });
          log.info(
            {
              paymentId: row.id,
              userId,
              plan: offer.plan,
              duration: offer.duration,
              expectedLamports: expectedLamports.toString(),
            },
            "payment.invoice_created",
          );
          return { ok: true, invoice: invoiceViewOf(row, now), reused: false };
        });
      } finally {
        key.secretKey.dispose();
      }
    },

    async getInvoice(paymentId, userId, now) {
      const row = await find(paymentId, userId);
      return row === null ? null : invoiceViewOf(await expireIfDue(row, now), now);
    },

    async checkInvoice(paymentId, { now, userId }) {
      const row = await find(paymentId, userId);
      if (row === null) return { kind: "NOT_FOUND", checkedAt: now };
      // A paid invoice needs no read: its deposit may even be empty already (V1-33).
      if (isPaid(row.status)) return paidOutcome(row, now);
      const balances = await readLamports([row.depositAddress]);
      return checkInvoiceWithBalance(row, balances.get(row.depositAddress) ?? 0n, now);
    },

    checkInvoiceWithBalance,

    async checkInvoicesBatch(payments, now) {
      const checks = new Map<string, InvoiceCheck>();
      for (const slice of chunk(payments, MAX_ACCOUNTS_PER_READ)) {
        let balances: Map<string, bigint>;
        try {
          balances = await readLamports(slice.map((payment) => payment.depositAddress));
        } catch (error) {
          log.warn({ err: error, invoices: slice.length }, "payment.batch_read_failed");
          continue;
        }
        for (const payment of slice) {
          try {
            const balance = balances.get(payment.depositAddress) ?? 0n;
            checks.set(payment.id, await checkInvoiceWithBalance(payment, balance, now));
          } catch (error) {
            // One invoice that fails never stops the others.
            log.error({ err: error, paymentId: payment.id }, "payment.check_failed");
          }
        }
      }
      return checks;
    },

    listInvoicesToCheck: (now) => {
      const windowStart = new Date(now.getTime() - LATE_PAYMENT_TOLERANCE_MS);
      return prisma.payment.findMany({
        where: {
          OR: [
            { status: "PENDING" },
            { status: "EXPIRED", expiresAt: { gt: windowStart } },
            // An invoice is canceled before its expiry, so `expiresAt` follows `canceledAt`:
            // the bound adds nothing but lets the (status, expiresAt) index skip old rows.
            { status: "CANCELED", canceledAt: { gt: windowStart }, expiresAt: { gt: windowStart } },
          ],
        },
        orderBy: { createdAt: "asc" },
        omit: WITHOUT_KEY,
      });
    },

    async cancelInvoice(paymentId, userId, now) {
      const found = await find(paymentId, userId);
      if (found === null) return "NOT_FOUND";
      const row = await expireIfDue(found, now);
      if (isPaid(row.status)) return "ALREADY_PAID";
      if (row.status !== "PENDING") return "NOOP";

      const { count } = await prisma.payment.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "CANCELED", canceledAt: now },
      });
      if (count === 1) {
        log.info({ paymentId: row.id, userId }, "payment.canceled");
        return "CANCELED";
      }
      // Paid or expired between the read and the write.
      const { status } = await prisma.payment.findUniqueOrThrow({
        where: { id: row.id },
        select: { status: true },
      });
      return isPaid(status) ? "ALREADY_PAID" : "NOOP";
    },

    async expireDueInvoices(now) {
      const { count } = await prisma.payment.updateMany({
        where: { status: "PENDING", expiresAt: { lte: now } },
        data: { status: "EXPIRED" },
      });
      return count;
    },
  };
}
