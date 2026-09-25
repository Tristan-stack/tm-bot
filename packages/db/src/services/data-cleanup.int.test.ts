import { DAY_MS } from "@launchbot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase } from "../test-db.js";
import { createDataCleanupService } from "./data-cleanup.js";

const NOW = new Date("2026-12-24T03:30:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("data cleanup (db, V1-45)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("cleanup"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deletes what is older than 90 days, keeps a draft a recent simulation points at", async () => {
    const user = await createTestUser(prisma);
    const other = await createTestUser(prisma);
    const draft = (userId: string, createdDays: number, updatedDays: number) =>
      prisma.tokenDraft.create({
        data: { userId, createdAt: daysAgo(createdDays), updatedAt: daysAgo(updatedDays) },
      });
    const simulation = (userId: string, tokenDraftId: string, days: number) =>
      prisma.simulation.create({
        data: { userId, tokenDraftId, devBuySol: 1, seed: 1, params: {}, createdAt: daysAgo(days) },
      });

    const oldDraft = await draft(user.id, 120, 91);
    const oldSimulation = await simulation(user.id, oldDraft.id, 91);
    const keptSimulation = await simulation(user.id, (await draft(user.id, 10, 10)).id, 89);
    // Untouched for 91 days, but a recent simulation points at it: both stay.
    const referenced = await draft(user.id, 100, 91);
    const recentOnOld = await simulation(user.id, referenced.id, 1);
    // Created 120 days ago, changed 10 days ago: it stays.
    const reused = await draft(user.id, 120, 10);
    const otherDraft = await draft(other.id, 5, 5);
    await prisma.aiGeneration.createMany({
      data: [
        { userId: user.id, kind: "TEXT", createdAt: daysAgo(91) },
        { userId: user.id, kind: "TEXT", createdAt: daysAgo(89) },
      ],
    });

    const report = await createDataCleanupService({ prisma }).runExpiredCleanup(NOW);

    expect(report).toEqual({ simulations: 1, drafts: 1, aiGenerations: 1 });
    const simulations = (await prisma.simulation.findMany()).map((row) => row.id).sort();
    expect(simulations).toEqual([keptSimulation.id, recentOnOld.id].sort());
    expect(simulations).not.toContain(oldSimulation.id);
    const drafts = (await prisma.tokenDraft.findMany()).map((row) => row.id);
    expect(drafts).not.toContain(oldDraft.id);
    expect(drafts).toEqual(expect.arrayContaining([referenced.id, reused.id, otherDraft.id]));
    expect(await prisma.aiGeneration.count()).toBe(1);
  });
});
