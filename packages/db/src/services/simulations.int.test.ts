import { HOUR_MS } from "@launchbot/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase } from "../test-db.js";
import { createSimulationStore } from "./simulations.js";
import { touchUserActivity } from "./user.js";

const NOW = new Date("2026-09-23T12:00:00Z");
const PARAMS = { seed: 42, devBuySol: 2.5, durationSec: 180 };

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("simulations (db)", () => {
  let prisma: PrismaClient;
  let userId: string;
  let telegramId: bigint;
  let draftId: string;
  const store = () => createSimulationStore({ prisma });

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("simulations"));
    const user = await createTestUser(prisma);
    userId = user.id;
    telegramId = user.telegramId;
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

  it("creates a row with the dev buy as a decimal, and finds the latest one back", async () => {
    const created = await store().create({
      userId,
      tokenDraftId: draftId,
      devBuySol: 2.5,
      seed: 42,
      params: PARAMS,
    });

    expect(created.devBuySol.toString()).toBe("2.5");
    expect(created.seed).toBe(42);
    const found = await store().findLatest(
      { userId, tokenDraftId: draftId, devBuySol: 2.5 },
      new Date(Date.now() - HOUR_MS),
    );
    expect(found?.id).toBe(created.id);
    expect(
      await store().findLatest({ userId, tokenDraftId: draftId, devBuySol: 3 }, new Date(0)),
    ).toBeNull();
  });

  it("reads a simulation for the API with its owner and its token", async () => {
    const created = await store().create({
      userId,
      tokenDraftId: draftId,
      devBuySol: 5,
      seed: 7,
      params: PARAMS,
    });

    const row = await store().findForViewer(created.id);

    expect(row).toEqual({
      id: created.id,
      createdAt: created.createdAt,
      params: PARAMS,
      ownerTelegramId: telegramId,
      tokenDraft: {
        name: "Moon Otter",
        symbol: "OTTR",
        description: null,
        imageFileId: null,
        website: null,
        twitter: null,
        telegram: null,
      },
    });
    expect(await store().findForViewer("cmfz1zzzz0000zzzzzzzzzzzz")).toBeNull();
  });

  it("records the activity of the Mini App without creating an account", async () => {
    expect(await touchUserActivity(prisma, Number(telegramId), NOW)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).lastActiveAt).toEqual(
      NOW,
    );

    expect(await touchUserActivity(prisma, 424_242, NOW)).toBe(false);
    expect(await prisma.user.count({ where: { telegramId: 424_242n } })).toBe(0);
  });
});
