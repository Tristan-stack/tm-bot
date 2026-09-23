import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createSimulationStore } from "./simulations.js";

const SINCE = new Date("2026-09-23T11:00:00Z");
const KEY = { userId: "u1", tokenDraftId: "d1", devBuySol: 2.5 };

function harness() {
  const prisma = {
    simulation: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: unknown }) =>
          Promise.resolve({ id: "s1", ...(data as object) }),
        ),
    },
  };
  return { prisma, store: createSimulationStore({ prisma: prisma as unknown as PrismaClient }) };
}

const VIEWER_ROW = {
  id: "s1",
  createdAt: new Date("2026-09-23T12:00:00Z"),
  params: { seed: 1 },
  user: { telegramId: 5_000_000_001n },
  tokenDraft: {
    name: "Moon Otter",
    symbol: "OTTR",
    description: null,
    imageFileId: "file-1",
    website: null,
    twitter: null,
    telegram: null,
  },
};

describe("createSimulationStore", () => {
  it("reads a simulation for the API with the Telegram id of its owner", async () => {
    const { prisma, store } = harness();
    prisma.simulation.findUnique.mockResolvedValue(VIEWER_ROW);

    const row = await store.findForViewer("s1");

    const { user, ...rest } = VIEWER_ROW;
    expect(row).toEqual({ ...rest, ownerTelegramId: user.telegramId });
    expect(prisma.simulation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1" } }),
    );
    prisma.simulation.findUnique.mockResolvedValue(null);
    expect(await store.findForViewer("s2")).toBeNull();
  });

  it("looks the latest row of the user, draft and dev buy up, as a decimal text", async () => {
    const { prisma, store } = harness();

    expect(await store.findLatest(KEY, SINCE)).toBeNull();
    expect(prisma.simulation.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", tokenDraftId: "d1", devBuySol: "2.5", createdAt: { gt: SINCE } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("creates the row with the seed and the params as given", async () => {
    const { prisma, store } = harness();
    const params = { seed: 7, devBuySol: 2.5 };

    const row = await store.create({ ...KEY, seed: 7, params });

    expect(row.id).toBe("s1");
    expect(prisma.simulation.create).toHaveBeenCalledWith({
      data: { userId: "u1", tokenDraftId: "d1", devBuySol: "2.5", seed: 7, params },
    });
  });
});
