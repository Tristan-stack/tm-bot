import type { User } from "@launchbot/db";
import { isWalletReady } from "@launchbot/shared";
import type { PlanStatus } from "@launchbot/shared";
import type { DataServices } from "../../services/data.js";

/** Everything the home screen shows (§4.3): `buildHomeScreen` reads nothing else. */
export type HomeData = {
  username: string | null;
  firstName: string | null;
  telegramId: bigint;
  subscription: PlanStatus;
  wallets: {
    count: number;
    /** `null`: the RPC is down and no balance of these wallets was ever read. */
    totalLamports: bigint | null;
    hasReadyWallet: boolean;
  };
  botChannelMembers: number | null;
  activeSubscribers: number;
  /** `null` hides every USD amount of the screen. */
  solUsd: number | null;
  /** When the balances shown were read; the time of the render without a wallet. */
  updatedAt: Date;
  now: Date;
};

/** What the home screen reads: a test fakes these five, not every data service. */
export type HomeSources = Pick<
  DataServices,
  | "getUserBalances"
  | "getPlanStatus"
  | "getBotChannelMemberCount"
  | "countActiveSubscribers"
  | "getSolUsdPrice"
>;

export type NextStep = "create_wallet" | "subscribe" | "fund_wallet" | "all_set";

/** §4.3: the first case that holds, in this order. Unknown balances are not ready. */
export function computeNextStep(data: Pick<HomeData, "wallets" | "subscription">): NextStep {
  if (data.wallets.count === 0) return "create_wallet";
  if (data.subscription.kind !== "ACTIVE") return "subscribe";
  if (!data.wallets.hasReadyWallet) return "fund_wallet";
  return "all_set";
}

/**
 * Sources are read in parallel, and none of them can keep the screen from showing: the price
 * and the member count fall back to `null`, the balances to "unavailable".
 */
export async function loadHomeData(
  sources: HomeSources,
  user: User,
  options: { skipBalanceCache: boolean; now?: Date },
): Promise<HomeData> {
  const [balances, subscription, botChannelMembers, activeSubscribers, solUsd] = await Promise.all([
    sources.getUserBalances(user.id, { skipCache: options.skipBalanceCache }),
    sources.getPlanStatus(user.id),
    sources.getBotChannelMemberCount(),
    sources.countActiveSubscribers(),
    // Never forced, even by a Refresh: the price stays cached 60 s for everyone (§4.4).
    sources.getSolUsdPrice(),
  ]);

  return {
    username: user.username,
    firstName: user.firstName,
    telegramId: user.telegramId,
    subscription,
    wallets: {
      count: balances.wallets.length,
      totalLamports: balances.totalLamports,
      hasReadyWallet: balances.wallets.some(
        (wallet) => wallet.lamports !== null && isWalletReady(wallet.lamports),
      ),
    },
    botChannelMembers,
    activeSubscribers,
    solUsd,
    updatedAt: balances.fetchedAt,
    now: options.now ?? new Date(),
  };
}
