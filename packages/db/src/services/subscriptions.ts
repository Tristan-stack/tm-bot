import { CACHE_TTL_MS, createTtlCache, getWalletLimit } from "@launchbot/shared";
import type { PrismaClient, Subscription } from "../generated/prisma/client.js";

// Reads only, and never cached (except the counter): an activation (V1-27, V1-28) must show
// at once. The rules of purchase, activation and expiry belong to V1-27.

export type SubscriptionInfo = Pick<
  Subscription,
  "id" | "plan" | "duration" | "startsAt" | "expiresAt"
>;

const INFO = { id: true, plan: true, duration: true, startsAt: true, expiresAt: true } as const;

/** The date filter covers an expiry job (V1-34) that runs late. */
const isActive = (now: Date) => ({ status: "ACTIVE", expiresAt: { gt: now } }) as const;

/** With several active subscriptions: Premium first, then the one that ends last. */
export function getActiveSubscription(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<SubscriptionInfo | null> {
  return prisma.subscription.findFirst({
    where: { userId, ...isActive(now) },
    // Enums sort in the order of their declaration: CLASSIC, then PREMIUM.
    orderBy: [{ plan: "desc" }, { expiresAt: "desc" }],
    select: INFO,
  });
}

export type SubscriptionSummary = {
  active: SubscriptionInfo | null;
  /** The subscription that ended last: the home screen says "Classic expired" (V1-08). */
  lastExpired: SubscriptionInfo | null;
};

export async function getSubscriptionSummary(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<SubscriptionSummary> {
  const [active, lastExpired] = await Promise.all([
    getActiveSubscription(prisma, userId, now),
    prisma.subscription.findFirst({
      where: { userId, OR: [{ status: "EXPIRED" }, { expiresAt: { lte: now } }] },
      orderBy: { expiresAt: "desc" },
      select: INFO,
    }),
  ]);
  return { active, lastExpired };
}

export type WalletQuota = {
  /** Can exceed `limit`: wallets are kept after an expiry or a downgrade (§8.1). */
  count: number;
  limit: number;
  reached: boolean;
};

export async function getWalletQuota(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<WalletQuota> {
  const [count, active] = await Promise.all([
    prisma.wallet.count({ where: { userId } }),
    getActiveSubscription(prisma, userId, now),
  ]);
  const limit = getWalletLimit(active?.plan ?? null);
  return { count, limit, reached: count >= limit };
}

/**
 * The counter of the home screen (§4.3), cached 60 s for everyone: users with an active
 * subscription, so two subscriptions of one user count once.
 */
export function createActiveSubscriberCounter(deps: {
  prisma: PrismaClient;
  now?: () => number;
}): () => Promise<number> {
  const { prisma, now = Date.now } = deps;
  const cache = createTtlCache<"count", number>({ ttlMs: CACHE_TTL_MS.activeSubscribers, now });
  return () =>
    cache.get("count", () =>
      prisma.user.count({ where: { subscriptions: { some: isActive(new Date(now())) } } }),
    );
}
