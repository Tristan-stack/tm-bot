import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../constants.js";
import { classifyDeposit, isWatchable, mayMoveDeposit } from "./deposits.js";
import type { PaymentStatus } from "./invoice.js";

const EXPIRES = new Date("2026-09-12T14:32:00Z");
const after = (ms: number) => new Date(EXPIRES.getTime() + ms);
const EXPECTED = 570_820_434n;

const deposit = (
  status: PaymentStatus,
  overrides: { expiresAt?: Date; canceledAt?: Date | null } = {},
) => ({ status, expiresAt: EXPIRES, canceledAt: null, ...overrides });

describe("isWatchable (§8.3, V1-33)", () => {
  it("never empties an address within its 24 h, then waits 2 more minutes", () => {
    expect(isWatchable(deposit("EXPIRED"), after(23 * HOUR_MS))).toBe(false);
    expect(isWatchable(deposit("EXPIRED"), after(24 * HOUR_MS + MINUTE_MS))).toBe(false);
    expect(isWatchable(deposit("EXPIRED"), after(24 * HOUR_MS + 2 * MINUTE_MS))).toBe(true);
  });

  it("counts the 24 h of a canceled invoice from its cancellation", () => {
    const canceled = deposit("CANCELED", {
      expiresAt: after(20 * MINUTE_MS),
      canceledAt: after(5 * MINUTE_MS),
    });
    expect(isWatchable(canceled, after(24 * HOUR_MS + 6 * MINUTE_MS))).toBe(false);
    expect(isWatchable(canceled, after(24 * HOUR_MS + 7 * MINUTE_MS))).toBe(true);
  });

  it("watches an address already moved to the treasury at once", () => {
    expect(isWatchable(deposit("SWEPT"), after(HOUR_MS))).toBe(true);
  });

  it("leaves PENDING and PAID invoices to their own jobs", () => {
    expect(isWatchable(deposit("PENDING", { expiresAt: after(DAY_MS) }), after(0))).toBe(false);
    expect(isWatchable(deposit("PAID"), after(2 * DAY_MS))).toBe(false);
  });

  it("stops 30 days after the end of the invoice", () => {
    expect(isWatchable(deposit("SWEPT"), after(30 * DAY_MS - 1))).toBe(true);
    expect(isWatchable(deposit("SWEPT"), after(30 * DAY_MS))).toBe(false);
  });

  it("reads a PENDING row past its 30 minutes as expired, like the payment loop", () => {
    expect(isWatchable(deposit("PENDING"), after(24 * HOUR_MS + 2 * MINUTE_MS))).toBe(true);
  });
});

describe("mayMoveDeposit", () => {
  it("moves a PAID deposit at once, any other one on the terms of the watch", () => {
    expect(mayMoveDeposit(deposit("PAID", { expiresAt: after(DAY_MS) }), after(0))).toBe(true);
    expect(mayMoveDeposit(deposit("PENDING", { expiresAt: after(DAY_MS) }), after(0))).toBe(false);
    expect(mayMoveDeposit(deposit("EXPIRED"), after(HOUR_MS))).toBe(false);
    expect(mayMoveDeposit(deposit("EXPIRED"), after(DAY_MS + 2 * MINUTE_MS))).toBe(true);
  });
});

describe("classifyDeposit", () => {
  const invoice = (
    status: Exclude<PaymentStatus, "PENDING">,
    sweepSignature: string | null = null,
  ) => ({ status, expectedLamports: EXPECTED, sweepSignature });

  it.each([
    ["PAID", null, EXPECTED, "PAID"],
    ["SWEPT", "sig", 10_000_000n, "OLD_ADDRESS"],
    ["EXPIRED", "sig", EXPECTED, "OLD_ADDRESS"],
    ["CANCELED", "sig", 10_000_000n, "OLD_ADDRESS"],
    ["EXPIRED", null, EXPECTED, "LATE_FULL_PAYMENT"],
    ["CANCELED", null, EXPECTED + 1n, "LATE_FULL_PAYMENT"],
    ["EXPIRED", null, EXPECTED - 1n, "PARTIAL_EXPIRED"],
    ["CANCELED", null, 300_000_000n, "PARTIAL_EXPIRED"],
  ] as const)("%s, swept %s, %s lamports → %s", (status, signature, balance, expected) => {
    expect(classifyDeposit(invoice(status, signature), balance)).toBe(expected);
  });
});
