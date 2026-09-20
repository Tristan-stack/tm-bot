import { createPrismaClient } from "@launchbot/db";
import type { PrismaClient } from "@launchbot/db";
import { resetTestDatabase } from "@launchbot/db/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONVERSATION_KEY_PREFIX, createSessionStorage } from "./middleware/session.js";

// Needs PostgreSQL (`pnpm db:up`), run by `pnpm test:db`.
describe.skipIf(!process.env["RUN_DB_TESTS"])("session storage (db)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Its own database: the db suite resets launchbot_test at the same time.
    prisma = createPrismaClient(await resetTestDatabase("bot"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps a session across two bot processes", async () => {
    const first = createSessionStorage(prisma);
    await first.write("777", { v: 1, screenMessageId: 42 });

    // A restart builds its own storage over the same rows.
    const second = createSessionStorage(prisma);

    expect(await second.read("777")).toEqual({ v: 1, screenMessageId: 42 });
  });

  it("overwrites the row of a chat instead of piling rows up", async () => {
    const storage = createSessionStorage(prisma);

    await storage.write("888", { v: 1, screenMessageId: 1 });
    await storage.write("888", { v: 1, screenMessageId: 2 });

    expect(await storage.read("888")).toEqual({ v: 1, screenMessageId: 2 });
    expect(await prisma.session.count({ where: { key: "888" } })).toBe(1);
  });

  it("drops a row it cannot read, so a deployment never breaks a chat", async () => {
    await prisma.session.create({ data: { key: "999", value: "{not json" } });

    expect(await createSessionStorage(prisma).read("999")).toBeUndefined();
  });

  it("deletes a row, and deleting twice is not an error", async () => {
    const storage = createSessionStorage(prisma);
    await storage.write("111", { v: 1 });

    await storage.delete("111");
    await storage.delete("111");

    expect(await prisma.session.findUnique({ where: { key: "111" } })).toBeNull();
  });

  it("shares the table with the conversations, under their own prefix", async () => {
    await createSessionStorage(prisma).write("222", { v: 1, screenMessageId: 7 });
    await prisma.session.create({ data: { key: `${CONVERSATION_KEY_PREFIX}222`, value: "{}" } });

    // Two rows, two keys: a conversation never overwrites a session.
    expect(await prisma.session.count({ where: { key: { contains: "222" } } })).toBe(2);
  });
});
