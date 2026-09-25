import { HOUR_MS, MINUTE_MS } from "@launchbot/shared";
import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client.js";
import { invoiceViewOf } from "./payments.js";
import type { InvoiceRow } from "./payments.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const EXPECTED = 570_820_434n;

describe("invoiceViewOf", () => {
  const row: InvoiceRow = {
    id: "cmufx7liy00662kls6czue8xa",
    userId: "user",
    plan: "PREMIUM",
    duration: "TWO_DAYS",
    priceUsd: new Prisma.Decimal("59.00"),
    solUsdRate: new Prisma.Decimal("103.36000000"),
    expectedLamports: EXPECTED,
    receivedLamports: 300_000_000n,
    depositAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    status: "PENDING",
    expiresAt: at(30 * MINUTE_MS),
    paidAt: null,
    canceledAt: null,
    sweepSignature: null,
    keyDeletedAt: null,
    sweepAlertedAt: null,
    createdAt: NOW,
  };

  it("shows the price of the invoice, what is left to send and the seconds left", () => {
    expect(invoiceViewOf(row, NOW)).toEqual({
      id: row.id,
      userId: "user",
      offer: expect.objectContaining({ code: "P2D" }) as unknown,
      priceUsd: "59.00",
      solUsdRate: "103.36",
      expectedLamports: EXPECTED,
      receivedLamports: 300_000_000n,
      remainingLamports: 270_820_434n,
      depositAddress: row.depositAddress,
      status: "PENDING",
      expiresAt: row.expiresAt,
      secondsLeft: 1_800,
    });
  });

  it("never goes below 0: a surplus leaves nothing to send, time past leaves 0 s", () => {
    const view = invoiceViewOf({ ...row, receivedLamports: EXPECTED + 5n }, at(HOUR_MS));

    expect(view.remainingLamports).toBe(0n);
    expect(view.secondsLeft).toBe(0);
  });
});
