import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS } from "../constants.js";
import { acceptanceDeadline, decideInvoice, effectiveStatus } from "./invoice.js";
import type { PaymentStatus } from "./invoice.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const EXPECTED = 570_820_434n;

const invoice = (
  status: PaymentStatus,
  expiresAt = at(20 * MINUTE_MS),
  canceledAt: Date | null = null,
) => ({
  status,
  expiresAt,
  canceledAt,
  expectedLamports: EXPECTED,
});

describe("decideInvoice (§8.3)", () => {
  it.each<PaymentStatus>(["PAID", "SWEPT"])("never decides twice on a %s invoice", (status) => {
    expect(decideInvoice(invoice(status), EXPECTED, NOW)).toEqual({ action: "ALREADY_PAID" });
  });

  it("activates a full payment, and a surplus", () => {
    expect(decideInvoice(invoice("PENDING"), EXPECTED, NOW)).toEqual({ action: "ACTIVATE" });
    expect(decideInvoice(invoice("PENDING"), EXPECTED + 1_000n, NOW)).toEqual({
      action: "ACTIVATE",
    });
  });

  it("reports a partial payment with the invoice still open", () => {
    expect(decideInvoice(invoice("PENDING"), EXPECTED - 1n, NOW)).toEqual({
      action: "REPORT",
      kind: "PARTIAL",
    });
  });

  it("reports nothing received on an open invoice", () => {
    expect(decideInvoice(invoice("PENDING"), 0n, NOW)).toEqual({
      action: "REPORT",
      kind: "NOT_DETECTED",
    });
  });

  it("treats a PENDING invoice past its 30 minutes as EXPIRED", () => {
    const due = invoice("PENDING", NOW);

    expect(decideInvoice(due, 0n, NOW)).toEqual({ action: "REPORT", kind: "EXPIRED" });
    expect(decideInvoice(due, 1n, NOW)).toEqual({ action: "REPORT", kind: "PARTIAL_EXPIRED" });
  });

  it("accepts a full payment up to 24 h after the expiry", () => {
    const expired = invoice("EXPIRED", at(-24 * HOUR_MS + MINUTE_MS));
    const late = invoice("EXPIRED", at(-24 * HOUR_MS - MINUTE_MS));

    expect(decideInvoice(expired, EXPECTED, NOW)).toEqual({ action: "ACTIVATE" });
    expect(decideInvoice(late, EXPECTED, NOW)).toEqual({
      action: "REPORT",
      kind: "LATE_FULL_PAYMENT",
    });
  });

  it("counts the 24 h of a canceled invoice from its cancellation", () => {
    const expiresAt = at(-30 * HOUR_MS);
    const canceled = invoice("CANCELED", expiresAt, at(-23 * HOUR_MS));
    const old = invoice("CANCELED", expiresAt, at(-25 * HOUR_MS));

    expect(decideInvoice(canceled, EXPECTED, NOW)).toEqual({ action: "ACTIVATE" });
    expect(decideInvoice(old, EXPECTED, NOW)).toEqual({
      action: "REPORT",
      kind: "LATE_FULL_PAYMENT",
    });
    expect(decideInvoice(canceled, 0n, NOW)).toEqual({ action: "REPORT", kind: "CANCELED" });
    expect(decideInvoice(canceled, 5n, NOW)).toEqual({
      action: "REPORT",
      kind: "PARTIAL_EXPIRED",
    });
  });
});

describe("effectiveStatus and acceptanceDeadline", () => {
  it("expires a PENDING invoice at its expiry, not before", () => {
    expect(effectiveStatus(invoice("PENDING", at(1)), NOW)).toBe("PENDING");
    expect(effectiveStatus(invoice("PENDING", NOW), NOW)).toBe("EXPIRED");
    expect(effectiveStatus(invoice("CANCELED", NOW), NOW)).toBe("CANCELED");
  });

  it("ends 24 h after the expiry, or after the cancellation", () => {
    expect(acceptanceDeadline(invoice("EXPIRED", NOW))).toEqual(at(24 * HOUR_MS));
    expect(acceptanceDeadline(invoice("CANCELED", at(HOUR_MS), NOW))).toEqual(at(24 * HOUR_MS));
  });
});
