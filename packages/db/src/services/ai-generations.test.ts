import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createAiQuotaStore, nextUtcMidnight, startOfUtcDay } from "./ai-generations.js";

const USER = "u1";
const NOON = new Date("2026-09-23T12:00:00Z");

type Row = { userId: string; kind: "TEXT" | "LOGO"; createdAt: Date };
type Where = { userId: string; kind: "TEXT" | "LOGO"; createdAt?: { gte: Date } };

/** The AiGeneration table in memory, with the date filter the store relies on. */
function harness(rows: Row[] = []) {
  const table = [...rows];
  const matching = (where: Where) =>
    table.filter(
      (row) =>
        row.userId === where.userId &&
        row.kind === where.kind &&
        (where.createdAt === undefined || row.createdAt >= where.createdAt.gte),
    );
  const prisma = {
    aiGeneration: {
      count: vi.fn(({ where }: { where: Where }) => Promise.resolve(matching(where).length)),
      create: vi.fn(({ data }: { data: { userId: string; kind: "TEXT" | "LOGO" } }) => {
        const row = { ...data, createdAt: NOON };
        table.push(row);
        return Promise.resolve(row);
      }),
    },
    $executeRaw: vi.fn(() => Promise.resolve(1)),
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(prisma),
  };
  return {
    prisma,
    table,
    store: createAiQuotaStore({ prisma: prisma as unknown as PrismaClient }),
  };
}

const textRow = (createdAt: string, userId = USER): Row => ({
  userId,
  kind: "TEXT",
  createdAt: new Date(createdAt),
});

describe("UTC day window", () => {
  it("starts at 00:00 UTC and resets at the next midnight", () => {
    expect(startOfUtcDay(new Date("2026-09-23T23:59:59.999Z")).toISOString()).toBe(
      "2026-09-23T00:00:00.000Z",
    );
    expect(nextUtcMidnight(NOON).toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });
});

describe("AI quota store", () => {
  it("counts the TEXT rows of the user since 00:00 UTC only", async () => {
    const { store } = harness([
      textRow("2026-09-23T00:00:00.000Z"),
      textRow("2026-09-23T11:00:00Z"),
      textRow("2026-09-22T23:59:59.999Z"),
      textRow("2026-09-23T11:00:00Z", "someone-else"),
      { userId: USER, kind: "LOGO", createdAt: NOON },
    ]);

    expect(await store.countText(USER, NOON)).toBe(2);
  });

  it("reserves a generation under the lock of the user and reports the count", async () => {
    const { store, prisma, table } = harness([textRow("2026-09-23T01:00:00Z")]);

    expect(await store.reserveText(USER, NOON)).toEqual({ ok: true, used: 2 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(table.filter((row) => row.kind === "TEXT")).toHaveLength(2);
  });

  it("refuses the 51st generation of the day without a row", async () => {
    const rows = Array.from({ length: 50 }, () => textRow("2026-09-23T01:00:00Z"));
    const { store, prisma } = harness(rows);

    expect(await store.reserveText(USER, NOON)).toEqual({ ok: false, used: 50 });
    expect(prisma.aiGeneration.create).not.toHaveBeenCalled();
  });

  it("opens a new window at 00:00 UTC", async () => {
    const rows = Array.from({ length: 50 }, () => textRow("2026-09-23T01:00:00Z"));
    const { store } = harness(rows);

    expect((await store.reserveText(USER, new Date("2026-09-23T23:59:59Z"))).ok).toBe(false);
    expect(await store.reserveText(USER, new Date("2026-09-24T00:00:00Z"))).toEqual({
      ok: true,
      used: 1,
    });
  });

  it("records a logo without counting it", async () => {
    const { store, table } = harness();

    await store.recordLogo(USER);

    expect(table).toEqual([{ userId: USER, kind: "LOGO", createdAt: NOON }]);
    expect(await store.countText(USER, NOON)).toBe(0);
  });
});
