import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { setChannelCheckedAt, touchUser } from "./user.js";

type UpsertArgs = {
  where: { telegramId: bigint };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

function fakePrisma() {
  const upsert = vi.fn((args: UpsertArgs) => Promise.resolve({ id: "u1", ...args.create }));
  return { prisma: { user: { upsert } } as unknown as PrismaClient, upsert };
}

const NOW = new Date("2026-09-20T14:32:00Z");

describe("touchUser", () => {
  it("creates the account on first contact", async () => {
    const { prisma, upsert } = fakePrisma();

    await touchUser(
      prisma,
      { telegramId: 123456789, username: "tristan", firstName: "Tristan" },
      NOW,
    );

    expect(upsert.mock.calls[0]?.[0]).toEqual({
      // ctx.from.id is a number, User.telegramId a BigInt.
      where: { telegramId: 123456789n },
      create: {
        telegramId: 123456789n,
        username: "tristan",
        firstName: "Tristan",
        lastActiveAt: NOW,
      },
      update: { username: "tristan", firstName: "Tristan", lastActiveAt: NOW },
    });
  });

  it("stores null rather than undefined for a user without a username", async () => {
    const { prisma, upsert } = fakePrisma();

    await touchUser(prisma, { telegramId: 1, firstName: "Tristan" }, NOW);

    expect(upsert.mock.calls[0]?.[0]?.create).toMatchObject({ username: null });
  });

  it("records the activity on every update: it drives the purge of inactive accounts", async () => {
    const { prisma, upsert } = fakePrisma();
    const later = new Date(NOW.getTime() + 60_000);

    await touchUser(prisma, { telegramId: 1, firstName: "Tristan" }, NOW);
    await touchUser(prisma, { telegramId: 1, firstName: "Tristan" }, later);

    expect(upsert.mock.calls[1]?.[0]?.update).toMatchObject({ lastActiveAt: later });
  });

  it("uses the current clock by default", async () => {
    const { prisma, upsert } = fakePrisma();
    const before = Date.now();

    await touchUser(prisma, { telegramId: 1, firstName: "Tristan" });

    const written = upsert.mock.calls[0]?.[0]?.update["lastActiveAt"] as Date;
    expect(written.getTime()).toBeGreaterThanOrEqual(before);
  });
});

function fakeUpdate() {
  const update = vi.fn((args: { where: { id: string }; data: Record<string, unknown> }) =>
    Promise.resolve({ id: args.where.id, ...args.data }),
  );
  return { prisma: { user: { update } } as unknown as PrismaClient, update };
}

describe("setChannelCheckedAt", () => {
  it("writes the date of a positive check, and null after a negative one", async () => {
    const { prisma, update } = fakeUpdate();

    await setChannelCheckedAt(prisma, "u1", NOW);
    await setChannelCheckedAt(prisma, "u1", null);

    expect(update.mock.calls.map(([args]) => args.data)).toEqual([
      { channelCheckedAt: NOW },
      { channelCheckedAt: null },
    ]);
  });
});
