import {
  createActiveSubscriberCounter,
  createBalancesService,
  getSubscriptionSummary,
  hasActivePremium,
} from "@launchbot/db";
import type { BalancesService, PrismaClient, SubscriptionSummary } from "@launchbot/db";
import type { Env } from "@launchbot/shared/server";
import {
  createCoinGeckoProvider,
  createCurveParamsService,
  createSolUsdPrice,
  getBalancesFresh,
  getSolanaRpc,
  readAccountInfo,
} from "@launchbot/solana";
import type { CurveParamsService, SolUsdPrice } from "@launchbot/solana";
import type { Api } from "grammy";
import { createChannelMemberCounter } from "./channel-stats.js";

export type DataServicesDeps = {
  prisma: PrismaClient;
  api: Pick<Api, "getChatMemberCount">;
  env: Pick<Env, "CHANNEL_BOT_ID" | "SOL_PRICE_API_URL" | "SOLANA_RPC_URL">;
};

/**
 * The cached reads behind the home screen and the screens after it (§4.3). One instance per
 * process: the caches live in it.
 */
export type DataServices = BalancesService &
  SolUsdPrice &
  CurveParamsService & {
    getSubscriptionSummary: (userId: string) => Promise<SubscriptionSummary>;
    /** AI Generate is Premium only (§5): the label of its button, and the click (V1-17). */
    hasActivePremium: (userId: string) => Promise<boolean>;
    countActiveSubscribers: () => Promise<number>;
    getBotChannelMemberCount: () => Promise<number | null>;
  };

export function createDataServices({ prisma, api, env }: DataServicesDeps): DataServices {
  // The connection the devnet guard verified at startup.
  const rpc = getSolanaRpc(env.SOLANA_RPC_URL);
  const curveParams = createCurveParamsService({
    getAccountInfo: (address) => readAccountInfo(rpc, address),
  });
  // Proposal (V1-21): read in the background at startup, so the first recap waits for no RPC.
  void curveParams.getCurveParams();

  return {
    ...curveParams,
    ...createBalancesService({
      prisma,
      readLamports: (addresses) => getBalancesFresh(rpc, addresses),
    }),
    ...createSolUsdPrice({ provider: createCoinGeckoProvider(env.SOL_PRICE_API_URL) }),
    getSubscriptionSummary: (userId) => getSubscriptionSummary(prisma, userId),
    hasActivePremium: (userId) => hasActivePremium(prisma, userId),
    countActiveSubscribers: createActiveSubscriberCounter({ prisma }),
    getBotChannelMemberCount: createChannelMemberCounter({ api, channelId: env.CHANNEL_BOT_ID }),
  };
}
