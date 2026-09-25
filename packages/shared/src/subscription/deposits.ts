import { DEPOSIT_WATCH_MS, WATCH_RACE_MARGIN_MS } from "../constants.js";
import { acceptanceDeadline, effectiveStatus } from "./invoice.js";
import type { PaymentStatus } from "./invoice.js";

// The deposit address of an invoice after its payment window (§8.3, §11.3, V1-33): when the
// worker may empty it into the treasury, and what the admins are told. Pure rules; the key of
// the deposit is checked by the queries that read the invoices (erased after 30 days).

/** Why the funds of a deposit are moved: the normal case, or one an admin must look at. */
export type DepositCase = "PAID" | "OLD_ADDRESS" | "LATE_FULL_PAYMENT" | "PARTIAL_EXPIRED";

type DepositState = { status: PaymentStatus; expiresAt: Date; canceledAt: Date | null };

/**
 * What the watch of V1-33 may empty: an invoice moved to the treasury already, or one that can
 * no longer activate — its 24 h over, plus a margin for a tick of the payment loop still on it.
 * Never within the 24 h: a partial payment completed later must still find its first part. The
 * 30 days of monitoring start at the end of the invoice (proposal), whatever its status.
 */
export function isWatchable(invoice: DepositState, now: Date): boolean {
  if (now.getTime() >= invoice.expiresAt.getTime() + DEPOSIT_WATCH_MS) return false;
  const status = effectiveStatus(invoice, now);
  if (status === "SWEPT") return true;
  if (status !== "EXPIRED" && status !== "CANCELED") return false;
  const closed = acceptanceDeadline({ ...invoice, status }).getTime() + WATCH_RACE_MARGIN_MS;
  return now.getTime() >= closed;
}

/**
 * When the funds of a deposit may go to the treasury: a PAID invoice at once, any other one on
 * the terms of the watch. A PENDING invoice never.
 */
export const mayMoveDeposit = (invoice: DepositState, now: Date): boolean =>
  invoice.status === "PAID" || isWatchable(invoice, now);

/**
 * What a balance on a deposit means (§8.3). An invoice moved once already only receives funds
 * nobody asked for; otherwise the amount says whether it was paid in full, too late.
 */
export function classifyDeposit(
  invoice: {
    status: Exclude<PaymentStatus, "PENDING">;
    expectedLamports: bigint;
    sweepSignature: string | null;
  },
  balance: bigint,
): DepositCase {
  if (invoice.status === "PAID") return "PAID";
  if (invoice.status === "SWEPT" || invoice.sweepSignature !== null) return "OLD_ADDRESS";
  return balance >= invoice.expectedLamports ? "LATE_FULL_PAYMENT" : "PARTIAL_EXPIRED";
}
