import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase } from "../test-db.js";
import { createAiQuotaStore } from "./ai-generations.js";

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("AI quota store (db)", () => {
  let prisma: PrismaClient;
  const NOW = new Date();

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("ai"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.aiGeneration.deleteMany();
  });

  it("accepts one of two simultaneous clicks at 49/50", async () => {
    const user = await createTestUser(prisma);
    const store = createAiQuotaStore({ prisma });
    await prisma.aiGeneration.createMany({
      data: Array.from({ length: 49 }, () => ({ userId: user.id, kind: "TEXT" as const })),
    });

    const results = await Promise.all([
      store.reserveText(user.id, NOW),
      store.reserveText(user.id, NOW),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.map((result) => result.used).sort()).toEqual([50, 50]);
    expect(await store.countText(user.id, NOW)).toBe(50);
  });

  it("keeps the quotas of two users apart", async () => {
    const [a, b] = await Promise.all([createTestUser(prisma), createTestUser(prisma)]);
    const store = createAiQuotaStore({ prisma, limit: 1 });

    expect(await store.reserveText(a.id, NOW)).toEqual({ ok: true, used: 1 });
    expect(await store.reserveText(b.id, NOW)).toEqual({ ok: true, used: 1 });
    expect(await store.reserveText(a.id, NOW)).toEqual({ ok: false, used: 1 });
  });
});
