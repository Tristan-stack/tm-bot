import { AI_GENERATIONS_PER_DAY } from "../constants.js";
import type { Plan } from "../constants.js";
import { getWalletLimit } from "../wallets.js";

/** What a plan unlocks (§8.1). `null`: no active subscription. */
export type PlanFeatures = {
  maxWallets: number;
  aiGenerate: boolean;
  /** AI Generate per UTC day (D9); 0 without Premium. */
  aiDailyQuota: number;
  prioritySupport: boolean;
  /** The Launch Coin flow (D2: the button is shown to everyone, the flow needs a plan). */
  launchCoin: boolean;
};

export const getPlanFeatures = (plan: Plan | null): PlanFeatures => ({
  maxWallets: getWalletLimit(plan),
  aiGenerate: plan === "PREMIUM",
  aiDailyQuota: plan === "PREMIUM" ? AI_GENERATIONS_PER_DAY : 0,
  prioritySupport: plan === "PREMIUM",
  launchCoin: plan !== null,
});
