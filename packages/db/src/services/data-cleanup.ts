import { CLEANUP_BATCH_SIZE, DATA_RETENTION_MS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { PrismaClient } from "../generated/prisma/client.js";

// The 90 days of §11.3 (V1-45): simulations, token drafts and the rows of the AI quota. The
// payments and the withdrawals stay (§13), the deposit keys go after 30 days (V1-33).

const log = createLogger("db:cleanup");

export type CleanupReport = { simulations: number; drafts: number; aiGenerations: number };

export type DataCleanupService = {
  /** One pass of `data.expired-cleanup`: everything older than 90 days at `now`, by batches. */
  runExpiredCleanup: (now: Date) => Promise<CleanupReport>;
};

/** Ids by batches, then one `deleteMany` each: a long run never holds one big statement. */
async function inBatches(
  select: () => Promise<{ id: string }[]>,
  remove: (ids: string[]) => Promise<{ count: number }>,
): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await select();
    if (rows.length === 0) return total;
    total += (await remove(rows.map((row) => row.id))).count;
    if (rows.length < CLEANUP_BATCH_SIZE) return total;
  }
}

export function createDataCleanupService(deps: { prisma: PrismaClient }): DataCleanupService {
  const { prisma } = deps;
  const ids = { select: { id: true }, take: CLEANUP_BATCH_SIZE } as const;

  return {
    async runExpiredCleanup(now) {
      const before = { lt: new Date(now.getTime() - DATA_RETENTION_MS) };

      const simulations = await inBatches(
        () => prisma.simulation.findMany({ where: { createdAt: before }, ...ids }),
        (batch) => prisma.simulation.deleteMany({ where: { id: { in: batch } } }),
      );
      // By the last change, not the creation (V1-02). A draft a simulation still points at stays:
      // `tokenDraftId` cascades, deleting it would take a recent simulation with it.
      const unused = { updatedAt: before, simulations: { none: {} } };
      const drafts = await inBatches(
        () => prisma.tokenDraft.findMany({ where: unused, ...ids }),
        (batch) => prisma.tokenDraft.deleteMany({ where: { id: { in: batch }, ...unused } }),
      );
      // Proposal: the quota of D9 counts the UTC day only.
      const aiGenerations = await inBatches(
        () => prisma.aiGeneration.findMany({ where: { createdAt: before }, ...ids }),
        (batch) => prisma.aiGeneration.deleteMany({ where: { id: { in: batch } } }),
      );

      const report = { simulations, drafts, aiGenerations };
      log.info(report, "data.cleanup");
      return report;
    },
  };
}
