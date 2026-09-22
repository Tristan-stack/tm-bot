import { describe, expect, it } from "vitest";
import { getWalletLimit, isWalletReady } from "./wallets.js";

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
});
