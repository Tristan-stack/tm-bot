import type { SweepResult, TreasuryService } from "@launchbot/db";
import { createUi } from "@launchbot/shared";
import type { DepositAlert } from "@launchbot/shared";
import { describe, expect, it, vi } from "vitest";
import type { TelegramSender } from "../telegram.js";
import { createDepositJobs } from "./deposits.js";

const NOW = new Date("2026-09-17T14:32:00Z");
const SIGNATURE = `5Hq1${"x".repeat(80)}Zk9a`;

const alertOf = (kind: "PARTIAL_EXPIRED" | "SWEEP_FAILED"): DepositAlert =>
  kind === "SWEEP_FAILED"
    ? {
        kind,
        invoice: invoiceOf(),
        user: null,
        balanceLamports: null,
        reason: "RPC_UNAVAILABLE",
        attempts: 9,
      }
    : {
        kind,
        invoice: invoiceOf(),
        user: null,
        balanceLamports: 300_000_000n,
        movedLamports: 299_985_000n,
        signature: SIGNATURE,
      };

function invoiceOf() {
  return {
    plan: "PREMIUM" as const,
    duration: "TWO_DAYS" as const,
    createdAt: NOW,
    priceUsd: "59.00",
    expectedLamports: 570_820_434n,
    depositAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    status: "EXPIRED" as const,
  };
}

function setup(result: SweepResult, failure: DepositAlert | null = null) {
  const treasury = {
    listPaidToSweep: vi.fn(() => Promise.resolve(["paid_1", "paid_2"])),
    watch: vi.fn(() => Promise.resolve(["old_1"])),
    sweepDeposit: vi.fn(() => Promise.resolve(result)),
    failureAlert: vi.fn(() => Promise.resolve(failure)),
    purgeKeys: vi.fn(() =>
      Promise.resolve({ purged: 3, sweep: ["late_1"], alerts: [alertOf("SWEEP_FAILED")] }),
    ),
  } satisfies TreasuryService;
  const notifyAdmins = vi.fn<TelegramSender["notifyAdmins"]>(() => Promise.resolve());
  const enqueueSweep = vi.fn(() => Promise.resolve());
  const jobs = createDepositJobs({
    treasury,
    telegram: { notifyAdmins },
    ui: createUi("devnet"),
    enqueueSweep,
    now: () => NOW,
  });
  return { jobs, treasury, notifyAdmins, enqueueSweep };
}

const job = (retryCount: number) => ({ paymentId: "pay_1", retryCount, retryLimit: 8 });

describe("deposits.sweep (V1-33)", () => {
  it("tells the admins after a transfer they must act on, never after a normal one", async () => {
    const refund = setup({
      kind: "SWEPT",
      depositCase: "PARTIAL_EXPIRED",
      signature: SIGNATURE,
      lamports: 299_985_000n,
      alert: alertOf("PARTIAL_EXPIRED"),
    });
    await refund.jobs.sweep(job(0));
    expect(refund.notifyAdmins).toHaveBeenCalledOnce();
    expect(refund.notifyAdmins.mock.calls[0]?.[0].text).toContain("<b>⚠️ MANUAL REFUND</b>");

    const paid = setup({
      kind: "SWEPT",
      depositCase: "PAID",
      signature: SIGNATURE,
      lamports: 570_000_000n,
      alert: null,
    });
    await paid.jobs.sweep(job(0));
    expect(paid.notifyAdmins).not.toHaveBeenCalled();
  });

  it("ends quietly when there is nothing to move", async () => {
    const { jobs, notifyAdmins } = setup({ kind: "NOTHING_TO_SWEEP" });

    await expect(jobs.sweep(job(0))).resolves.toBeUndefined();
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("throws for a retry while attempts are left, without an alert", async () => {
    const failed = setup({ kind: "FAILED", reason: "RPC_UNAVAILABLE" });
    await expect(failed.jobs.sweep(job(3))).rejects.toThrow("RPC_UNAVAILABLE");
    expect(failed.treasury.failureAlert).not.toHaveBeenCalled();

    const inFlight = setup({ kind: "IN_FLIGHT" });
    await expect(inFlight.jobs.sweep(job(0))).rejects.toThrow("IN_FLIGHT");
  });

  it("tells the admins once on the last attempt, then fails the job", async () => {
    const last = setup({ kind: "FAILED", reason: "RPC_UNAVAILABLE" }, alertOf("SWEEP_FAILED"));

    await expect(last.jobs.sweep(job(8))).rejects.toThrow();

    expect(last.treasury.failureAlert).toHaveBeenCalledWith("pay_1", "RPC_UNAVAILABLE", 9);
    expect(last.notifyAdmins.mock.calls[0]?.[0].text).toContain("<b>⚠️ SWEEP FAILED</b>");

    // Already told: the marker of the service says so, nothing goes out.
    const again = setup({ kind: "FAILED", reason: "RPC_UNAVAILABLE" }, null);
    await expect(again.jobs.sweep(job(8))).rejects.toThrow();
    expect(again.notifyAdmins).not.toHaveBeenCalled();
  });
});

describe("the crons of the deposits (V1-33)", () => {
  it("sweep-paid and watch enqueue one transfer per invoice", async () => {
    const { jobs, enqueueSweep, treasury } = setup({ kind: "NOTHING_TO_SWEEP" });

    await jobs.sweepPaid();
    await jobs.watch();

    expect(enqueueSweep.mock.calls).toEqual([["paid_1"], ["paid_2"], ["old_1"]]);
    expect(treasury.watch).toHaveBeenCalledWith(NOW);
  });

  it("purge-keys moves what it found first, and passes its alerts on", async () => {
    const { jobs, enqueueSweep, notifyAdmins, treasury } = setup({ kind: "NOTHING_TO_SWEEP" });

    await jobs.purgeKeys();

    expect(treasury.purgeKeys).toHaveBeenCalledWith(NOW);
    expect(enqueueSweep).toHaveBeenCalledWith("late_1");
    expect(notifyAdmins).toHaveBeenCalledOnce();
  });
});
