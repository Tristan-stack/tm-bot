import { describe, expect, it } from "vitest";
import {
  computeMaxAmount,
  getWalletLimit,
  getWithdrawFeeBudgetLamports,
  isBalanceWithdrawable,
  isWalletReady,
  priorityFeeLamports,
  transferFeeLamports,
} from "./wallets.js";

describe("wallet rules", () => {
  it("allows 3 wallets without a subscription, 5 in Classic and 10 in Premium", () => {
    expect([getWalletLimit(null), getWalletLimit("CLASSIC"), getWalletLimit("PREMIUM")]).toEqual([
      3, 5, 10,
    ]);
  });

  it("calls a wallet ready from 1.050 SOL", () => {
    expect(isWalletReady(1_050_000_000n)).toBe(true);
    expect(isWalletReady(1_049_999_999n)).toBe(false);
  });

  it("rounds a priority fee up to the lamport", () => {
    expect(priorityFeeLamports(540, 0n)).toBe(0n);
    // 540 units at 1 000 µL are 0.54 lamport: one is paid.
    expect(priorityFeeLamports(540, 1_000n)).toBe(1n);
    expect(priorityFeeLamports(540, 1_000_000n)).toBe(540n);
  });

  it("prices a standard transfer at the unit ceiling plus one signature", () => {
    expect(transferFeeLamports(0n)).toBe(5_000n);
    expect(transferFeeLamports(1_000_000n)).toBe(6_000n);
  });

  it("budgets the base fee plus the priority fee at its ceiling for a withdrawal", () => {
    expect(getWithdrawFeeBudgetLamports(0)).toBe(5_000n);
    expect(getWithdrawFeeBudgetLamports(1_000_000)).toBe(6_000n);
    // 1 500 microlamports × 1 000 units = 1.5 lamport, rounded up.
    expect(getWithdrawFeeBudgetLamports(1_500)).toBe(5_002n);
  });

  it("leaves the fees behind for Max, and never goes below 0", () => {
    expect(computeMaxAmount(1_000_000n, 5_000n)).toBe(995_000n);
    expect(computeMaxAmount(5_000n, 5_000n)).toBe(0n);
    expect(computeMaxAmount(1_000n, 5_000n)).toBe(0n);
  });

  it("lets a wallet be deleted at the fee budget, not one lamport above", () => {
    expect(isBalanceWithdrawable(6_000n, 6_000n)).toBe(false);
    expect(isBalanceWithdrawable(6_001n, 6_000n)).toBe(true);
    expect(isBalanceWithdrawable(0n, 6_000n)).toBe(false);
  });
});
