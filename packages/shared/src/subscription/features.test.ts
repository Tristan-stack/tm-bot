import { describe, expect, it } from "vitest";
import { AI_GENERATIONS_PER_DAY, WALLET_LIMITS } from "../constants.js";
import { getWalletLimit } from "../wallets.js";
import { getPlanFeatures } from "./features.js";

describe("getPlanFeatures (§8.1)", () => {
  it("gives 3 wallets and no Launch Coin without a subscription (D1, D2)", () => {
    expect(getPlanFeatures(null)).toEqual({
      maxWallets: 3,
      aiGenerate: false,
      aiDailyQuota: 0,
      prioritySupport: false,
      launchCoin: false,
    });
  });

  it("gives Classic 5 wallets and Launch Coin", () => {
    expect(getPlanFeatures("CLASSIC")).toEqual({
      maxWallets: 5,
      aiGenerate: false,
      aiDailyQuota: 0,
      prioritySupport: false,
      launchCoin: true,
    });
  });

  it("gives Premium 10 wallets, AI Generate 50 a day and priority support", () => {
    expect(getPlanFeatures("PREMIUM")).toEqual({
      maxWallets: 10,
      aiGenerate: true,
      aiDailyQuota: AI_GENERATIONS_PER_DAY,
      prioritySupport: true,
      launchCoin: true,
    });
  });

  it("reads the same wallet limits as the wallet quota of V1-07", () => {
    for (const plan of ["CLASSIC", "PREMIUM", null] as const) {
      expect(getPlanFeatures(plan).maxWallets).toBe(getWalletLimit(plan));
      expect(getPlanFeatures(plan).maxWallets).toBe(WALLET_LIMITS[plan ?? "NONE"]);
    }
  });
});
