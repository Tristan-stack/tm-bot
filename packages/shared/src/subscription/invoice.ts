import { LATE_PAYMENT_TOLERANCE_MS } from "../constants.js";

/** Same values as the Prisma enum of `Payment.status` (V1-02). */
export const PAYMENT_STATUSES = ["PENDING", "PAID", "EXPIRED", "CANCELED", "SWEPT"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Paid, then possibly moved to the treasury (V1-33): an invoice never decided again. */
export const isPaid = (status: PaymentStatus): status is "PAID" | "SWEPT" =>
  status === "PAID" || status === "SWEPT";

type InvoiceDates = { status: PaymentStatus; expiresAt: Date; canceledAt: Date | null };

/** A PENDING invoice whose 30 minutes are over is EXPIRED, whether or not a job said so. */
export const effectiveStatus = (invoice: Omit<InvoiceDates, "canceledAt">, now: Date) =>
  invoice.status === "PENDING" && invoice.expiresAt <= now ? "EXPIRED" : invoice.status;

/**
 * Until when a full payment still activates (§8.3): 24 h after the expiry, or after the
 * cancellation, since the SOL amount was frozen.
 */
export function acceptanceDeadline(invoice: InvoiceDates): Date {
  const from =
    invoice.status === "CANCELED" ? (invoice.canceledAt ?? invoice.expiresAt) : invoice.expiresAt;
  return new Date(from.getTime() + LATE_PAYMENT_TOLERANCE_MS);
}

/** What a check reports when it activates nothing. */
export type InvoiceReportKind =
  "NOT_DETECTED" | "PARTIAL" | "EXPIRED" | "CANCELED" | "PARTIAL_EXPIRED" | "LATE_FULL_PAYMENT";

/** What the tree of §8.3 decides from a balance, before anything is written. */
export type InvoiceDecision =
  | { action: "ALREADY_PAID" }
  | { action: "ACTIVATE" }
  | { action: "REPORT"; kind: InvoiceReportKind };

/** The tree of V1-28: only the deposit balance counts, never who sent it (§8.3). */
export function decideInvoice(
  invoice: InvoiceDates & { expectedLamports: bigint },
  balance: bigint,
  now: Date,
): InvoiceDecision {
  const status = effectiveStatus(invoice, now);
  if (isPaid(status)) return { action: "ALREADY_PAID" };
  const open = status === "PENDING";
  if (balance >= invoice.expectedLamports) {
    return now <= acceptanceDeadline({ ...invoice, status })
      ? { action: "ACTIVATE" }
      : { action: "REPORT", kind: "LATE_FULL_PAYMENT" };
  }
  if (balance > 0n) return { action: "REPORT", kind: open ? "PARTIAL" : "PARTIAL_EXPIRED" };
  return { action: "REPORT", kind: open ? "NOT_DETECTED" : status };
}
