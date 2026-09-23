import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, TokenDraft } from "../generated/prisma/client.js";
import { createTokenDraftService } from "./token-drafts.js";

const T0 = new Date("2026-09-23T12:00:00Z");
const USER = "u1";
const OTHER = "u2";

type Row = TokenDraft & { simulations: number };

/** The TokenDraft table in memory, with the count of simulations each row has. */
function harness(rows: Partial<Row>[] = []) {
  const table: Row[] = rows.map((row, index) => ({
    id: `d${index + 1}`,
    userId: USER,
    name: null,
    symbol: null,
    description: null,
    imageFileId: null,
    website: null,
    twitter: null,
    telegram: null,
    createdAt: T0,
    updatedAt: T0,
    simulations: 0,
    ...row,
  }));
  const publicOf = (row: Row): TokenDraft => {
    const draft: Partial<Row> = { ...row };
    delete draft.simulations;
    return draft as TokenDraft;
  };
  const find = (where: { id: string; userId: string }) =>
    table.find((row) => row.id === where.id && row.userId === where.userId);

  const prisma = {
    tokenDraft: {
      findFirst: vi.fn(
        ({ where, include }: { where: { id: string; userId: string }; include?: unknown }) => {
          const row = find(where);
          if (row === undefined) return Promise.resolve(null);
          return Promise.resolve(
            include === undefined
              ? publicOf(row)
              : { ...publicOf(row), _count: { simulations: row.simulations } },
          );
        },
      ),
      create: vi.fn(({ data }: { data: Partial<Row> & { userId: string } }) => {
        const row: Row = {
          ...table[0]!,
          id: `d${table.length + 1}`,
          name: null,
          symbol: null,
          description: null,
          imageFileId: null,
          website: null,
          twitter: null,
          telegram: null,
          simulations: 0,
          ...data,
        };
        table.push(row);
        return Promise.resolve(publicOf(row));
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = table.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(publicOf(row));
      }),
    },
  };
  return {
    prisma,
    table,
    service: createTokenDraftService({ prisma: prisma as unknown as PrismaClient }),
  };
}

describe("token draft service", () => {
  it("creates the draft lazily on the first write", async () => {
    const { service, table } = harness([{ id: "seed" }]);

    const draft = await service.write(USER, null, { name: "Moon Otter", symbol: "OTTR" });

    expect(draft).toMatchObject({ userId: USER, name: "Moon Otter", symbol: "OTTR" });
    expect(table).toHaveLength(2);
  });

  it("updates a draft of the user in place", async () => {
    const { service, prisma } = harness([{ name: "Moon Otter", symbol: "OTTR" }]);

    const draft = await service.write(USER, "d1", { website: "https://moon.com" });

    expect(draft).toMatchObject({ id: "d1", name: "Moon Otter", website: "https://moon.com" });
    expect(prisma.tokenDraft.create).not.toHaveBeenCalled();
  });

  it("copies a draft a Simulation references instead of modifying it", async () => {
    const { service, table } = harness([
      { name: "Moon Otter", symbol: "OTTR", website: "https://moon.com", simulations: 1 },
    ]);

    const draft = await service.write(USER, "d1", { name: "Cosmic Pickle", symbol: "PCKL" });

    expect(draft.id).toBe("d2");
    expect(draft).toMatchObject({
      name: "Cosmic Pickle",
      symbol: "PCKL",
      website: "https://moon.com",
    });
    expect(table[0]).toMatchObject({ id: "d1", name: "Moon Otter", symbol: "OTTR" });
  });

  it("refuses the draft of another user: a read gives null, a write starts a new draft", async () => {
    const { service, table } = harness([{ userId: OTHER, name: "Theirs" }]);

    expect(await service.getOwnedDraft(USER, "d1")).toBeNull();
    const draft = await service.write(USER, "d1", { name: "Mine" });

    expect(draft).toMatchObject({ id: "d2", userId: USER, name: "Mine" });
    expect(table[0]).toMatchObject({ userId: OTHER, name: "Theirs" });
  });

  it("clears a field with null", async () => {
    const { service } = harness([{ imageFileId: "file-1" }]);

    expect(await service.write(USER, "d1", { imageFileId: null })).toMatchObject({
      imageFileId: null,
    });
  });
});
