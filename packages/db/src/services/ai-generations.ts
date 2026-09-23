import { AI_GENERATIONS_PER_DAY, DAY_MS } from "@launchbot/shared";
import type { PrismaClient } from "../generated/prisma/client.js";

/** The window of the quota (D9): the UTC calendar day. */
export const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
export const nextUtcMidnight = (now: Date): Date => new Date(startOfUtcDay(now).getTime() + DAY_MS);

/** `used` includes the row just added when `ok`. */
export type AiQuotaReservation = { ok: boolean; used: number };

/**
 * The rows of `AiGeneration` (§13) behind the 50 per day of AI Generate (D9). One TEXT row per
 * accepted click, whatever generated the text; a LOGO row is recorded but not counted
 * (proposal: one click is one generation). The store owns the limit: nobody else reports it.
 */
export type AiQuotaStore = {
  readonly limit: number;
  /** TEXT rows of the user since 00:00 UTC. */
  countText: (userId: string, now: Date) => Promise<number>;
  /**
   * Counts and inserts under an advisory lock per user, so two clicks at 49/50 accept one
   * generation.
   */
  reserveText: (userId: string, now: Date) => Promise<AiQuotaReservation>;
  recordLogo: (userId: string) => Promise<void>;
};

export type AiQuotaDeps = { prisma: PrismaClient; limit?: number };

export function createAiQuotaStore({ prisma, limit = AI_GENERATIONS_PER_DAY }: AiQuotaDeps) {
  const today = (userId: string, now: Date) =>
    ({ userId, kind: "TEXT", createdAt: { gte: startOfUtcDay(now) } }) as const;

  const store: AiQuotaStore = {
    limit,

    countText: (userId, now) => prisma.aiGeneration.count({ where: today(userId, now) }),

    reserveText: (userId, now) =>
      prisma.$transaction(async (tx) => {
        // $queryRaw fails on a void column: $executeRaw it is.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai:${userId}`}))`;
        const used = await tx.aiGeneration.count({ where: today(userId, now) });
        if (used >= limit) return { ok: false, used };
        await tx.aiGeneration.create({ data: { userId, kind: "TEXT" } });
        return { ok: true, used: used + 1 };
      }),

    async recordLogo(userId) {
      await prisma.aiGeneration.create({ data: { userId, kind: "LOGO" } });
    },
  };
  return store;
}
