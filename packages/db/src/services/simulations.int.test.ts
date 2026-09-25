import { HOUR_MS } from "@launchbot/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase } from "../test-db.js";
import { createSimulationStore } from "./simulations.js";

const PARAMS = { seed: 42, devBuySol: 1, bundleSol: 3.5, durationSec: 180 };

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("simulations (db)", () => {
  let prisma: PrismaClient;
  let userId: string;
  let draftId: string;
  const store = () => createSimulationStore({ prisma });

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("simulations"));
    const user = await createTestUser(prisma);
    userId = user.id;
    draftId = (
      await prisma.tokenDraft.create({ data: { userId, name: "Moon Otter", symbol: "OTTR" } })
    ).id;
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.simulation.deleteMany();
  });

  it("creates a row with the dev buy and the bundle as decimals, and finds it back", async () => {
    const key = { userId, tokenDraftId: draftId, devBuySol: 1, bundleSol: 3.5 };
    const created = await store().create({ ...key, seed: 42, params: PARAMS });

    expect(created.devBuySol.toString()).toBe("1");
    expect(created.bundleSol.toString()).toBe("3.5");
    expect(created.seed).toBe(42);
    const found = await store().findLatest(key, new Date(Date.now() - HOUR_MS));
    expect(found?.id).toBe(created.id);
    // Another bundle is another simulation (decision of 25/09/2026).
    expect(await store().findLatest({ ...key, bundleSol: 5 }, new Date(0))).toBeNull();
  });
});
