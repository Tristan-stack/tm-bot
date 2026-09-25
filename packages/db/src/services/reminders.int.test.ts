import { DAY_MS, getOffer, HOUR_MS, MINUTE_MS } from "@launchbot/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase } from "../test-db.js";
import { createReminderService } from "./reminders.js";
import { createSubscriptionService } from "./subscriptions.js";

const NOW = new Date("2026-09-17T08:32:00Z");
const inHours = (hours: number, minutes = 0) =>
  new Date(NOW.getTime() + hours * HOUR_MS + minutes * MINUTE_MS);

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("end-of-plan reminders (db, V1-34)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("reminders"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany();
  });

  async function subscription(
    duration: "TWO_DAYS" | "ONE_MONTH",
    expiresAt: Date,
    status: "ACTIVE" | "EXPIRED" = "ACTIVE",
  ) {
    const user = await createTestUser(prisma);
    return prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "PREMIUM",
        duration,
        status,
        startsAt: new Date(expiresAt.getTime() - 2 * DAY_MS),
        expiresAt,
      },
    });
  }

  it("lists what is within its notice, to the minute, the closest end first", async () => {
    const month = await subscription("ONE_MONTH", inHours(23, 59));
    const pass = await subscription("TWO_DAYS", inHours(5, 59));
    await subscription("TWO_DAYS", inHours(6, 1)); // 6 h notice: not yet
    await subscription("ONE_MONTH", inHours(24, 1)); // 24 h notice: not yet
    await subscription("TWO_DAYS", NOW); // over: no reminder, only the expiry
    await subscription("TWO_DAYS", inHours(2), "EXPIRED"); // replaced by an upgrade

    const due = await createReminderService({ prisma }).listDue(NOW);

    expect(due.map((reminder) => reminder.id)).toEqual([pass.id, month.id]);
    expect(due[0]).toMatchObject({ plan: "PREMIUM", telegramId: expect.any(BigInt) as unknown });
  });

  it("claims once, even with two runs at the same time", async () => {
    await subscription("TWO_DAYS", inHours(5));
    const reminders = createReminderService({ prisma });
    const [due] = await reminders.listDue(NOW);
    if (due === undefined) throw new Error("no reminder due");

    const claims = await Promise.all([reminders.claim(due, NOW), reminders.claim(due, NOW)]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await reminders.listDue(NOW)).toEqual([]);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { id: due.id } })).toMatchObject({
      reminderSentAt: NOW,
      reminderForExpiresAt: due.expiresAt,
    });
  });

  it("a released claim is due again at the next run", async () => {
    await subscription("ONE_MONTH", inHours(12));
    const reminders = createReminderService({ prisma });
    const [due] = await reminders.listDue(NOW);
    if (due === undefined) throw new Error("no reminder due");

    await reminders.claim(due, NOW);
    await reminders.release(due);

    expect((await reminders.listDue(NOW)).map((reminder) => reminder.id)).toEqual([due.id]);
  });

  it("an extension re-arms the reminder for the new end, with the notice of the last pass", async () => {
    const user = await createTestUser(prisma);
    const subscriptions = createSubscriptionService({ prisma });
    const reminders = createReminderService({ prisma });
    await subscriptions.grantSubscription({
      userId: user.id,
      offer: getOffer("PREMIUM", "TWO_DAYS"),
      now: NOW,
      actorTelegramId: 1n,
    });
    const nearEnd = new Date(NOW.getTime() + 43 * HOUR_MS);
    const [first] = await reminders.listDue(nearEnd);
    if (first === undefined) throw new Error("no reminder due");
    expect(await reminders.claim(first, nearEnd)).toBe(true);

    // A month bought again (EXTEND): the end moves by 30 days, the notice becomes 24 h.
    await subscriptions.grantSubscription({
      userId: user.id,
      offer: getOffer("PREMIUM", "ONE_MONTH"),
      now: nearEnd,
      actorTelegramId: 1n,
    });
    const newEnd = first.expiresAt.getTime() + 30 * DAY_MS;
    expect(await reminders.listDue(new Date(newEnd - 25 * HOUR_MS))).toEqual([]);
    const [second] = await reminders.listDue(new Date(newEnd - 23 * HOUR_MS - MINUTE_MS));
    expect(second).toMatchObject({ id: first.id, duration: "ONE_MONTH" });
  });
});
