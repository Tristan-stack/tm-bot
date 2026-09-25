import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createSimulationStore } from "./simulations.js";

const SINCE = new Date("2026-09-23T11:00:00Z");
const KEY = { userId: "u1", tokenDraftId: "d1", devBuySol: 1, bundleSol: 3.5 };

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
  it("reads this user's simulation with its draft, for the chat to run it", async () => {
    const { prisma, store } = harness();
    const row = { id: "s1", userId: "u1", tokenDraft: { name: "Moon Otter", symbol: "OTTR" } };
    prisma.simulation.findFirst.mockResolvedValue(row);

    expect(await store.findOwnedWithDraft("u1", "s1")).toBe(row);
    expect(prisma.simulation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1", userId: "u1" } }),
    );
    prisma.simulation.findFirst.mockResolvedValue(null);
    expect(await store.findOwnedWithDraft("u1", "s2")).toBeNull();
  });

  it("looks the latest row of the user, draft and dev buy up, as a decimal text", async () => {
    const { prisma, store } = harness();

    expect(await store.findLatest(KEY, SINCE)).toBeNull();
    expect(prisma.simulation.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        tokenDraftId: "d1",
        devBuySol: "1",
        bundleSol: "3.5",
        createdAt: { gt: SINCE },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("creates the row with the seed and the params as given", async () => {
    const { prisma, store } = harness();
    const params = { seed: 7, devBuySol: 1, bundleSol: 3.5 };

    const row = await store.create({ ...KEY, seed: 7, params });

    expect(row.id).toBe("s1");
    expect(prisma.simulation.create).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        tokenDraftId: "d1",
        devBuySol: "1",
        bundleSol: "3.5",
        seed: 7,
        params,
      },
    });
  });
});
