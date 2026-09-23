import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createSimulationStore } from "./simulations.js";

const SINCE = new Date("2026-09-23T11:00:00Z");
const KEY = { userId: "u1", tokenDraftId: "d1", devBuySol: 2.5 };

function harness() {
  const prisma = {
    simulation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: unknown }) =>
          Promise.resolve({ id: "s1", ...(data as object) }),
        ),
    },
  };
  return { prisma, store: createSimulationStore({ prisma: prisma as unknown as PrismaClient }) };
}

describe("createSimulationStore", () => {
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
