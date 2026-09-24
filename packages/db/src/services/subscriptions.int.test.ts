import { DAY_MS, HOUR_MS, SECOND_MS } from "@launchbot/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { Plan, PrismaClient, SubscriptionStatus } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase, testWalletData } from "../test-db.js";
import {
  createActiveSubscriberCounter,
  getActiveSubscription,
  getPlanStatus,
  getWalletQuota,
} from "./subscriptions.js";

const NOW = new Date("2026-09-21T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("subscription reads (db)", () => {
  let prisma: PrismaClient;
  const createUser = () => createTestUser(prisma);

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("subscriptions"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany();
  });

  const subscribe = (
    userId: string,
    plan: Plan,
    expiresAt: Date,
    status: SubscriptionStatus = "ACTIVE",
  ) =>
    prisma.subscription.create({
      data: { userId, plan, duration: "ONE_MONTH", status, startsAt: at(-30 * DAY_MS), expiresAt },
    });

  const addWallets = (userId: string, count: number) =>
    prisma.wallet.createMany({
      data: Array.from({ length: count }, (_, index) =>
        testWalletData(userId, `Wallet ${index}`, `${userId}-${index}`),
      ),
    });

  describe("getActiveSubscription", () => {
    it("returns null for a user who never subscribed", async () => {
      const user = await createUser();

      expect(await getActiveSubscription(prisma, user.id, NOW)).toBeNull();
    });

    it("returns the active subscription, with only what screens need", async () => {
      const user = await createUser();
      const created = await subscribe(user.id, "CLASSIC", at(DAY_MS));

      expect(await getActiveSubscription(prisma, user.id, NOW)).toEqual({
        id: created.id,
        plan: "CLASSIC",
        duration: "ONE_MONTH",
        startsAt: created.startsAt,
        expiresAt: created.expiresAt,
      });
    });

    it("ignores an ACTIVE row whose date has passed: the expiry job may run late", async () => {
      const user = await createUser();
      await subscribe(user.id, "PREMIUM", NOW);

      expect(await getActiveSubscription(prisma, user.id, NOW)).toBeNull();
    });

    it("reads the ACTIVE row among the expired ones", async () => {
      const user = await createUser();
      await subscribe(user.id, "PREMIUM", at(20 * DAY_MS), "EXPIRED");
      const active = await subscribe(user.id, "CLASSIC", at(DAY_MS));

      expect((await getActiveSubscription(prisma, user.id, NOW))?.id).toBe(active.id);
    });
  });

  describe("getPlanStatus", () => {
    it("reports the subscription that ended last, whatever its status says", async () => {
      const user = await createUser();
      await subscribe(user.id, "PREMIUM", at(-10 * DAY_MS), "EXPIRED");
      const late = await subscribe(user.id, "CLASSIC", at(-HOUR_MS));

      expect(await getPlanStatus(prisma, user.id, NOW)).toMatchObject({
        kind: "EXPIRED",
        subscription: { id: late.id, plan: "CLASSIC" },
      });
    });

    it("reports the active plan of a user who subscribed again", async () => {
      const user = await createUser();
      await subscribe(user.id, "CLASSIC", at(-DAY_MS), "EXPIRED");
      await subscribe(user.id, "PREMIUM", at(DAY_MS));

      expect(await getPlanStatus(prisma, user.id, NOW)).toMatchObject({
        kind: "ACTIVE",
        subscription: { plan: "PREMIUM", expiresAt: at(DAY_MS) },
      });
    });

    it("reports nothing for a user who never subscribed", async () => {
      const user = await createUser();

      expect(await getPlanStatus(prisma, user.id, NOW)).toEqual({ kind: "NONE" });
    });
  });

  describe("getWalletQuota", () => {
    it("allows 3 wallets without a subscription", async () => {
      const user = await createUser();
      await addWallets(user.id, 2);

      expect(await getWalletQuota(prisma, user.id, NOW)).toEqual({
        count: 2,
        limit: 3,
        reached: false,
      });
    });

    it("is reached at 5/5 in Classic", async () => {
      const user = await createUser();
      await subscribe(user.id, "CLASSIC", at(DAY_MS));
      await addWallets(user.id, 5);

      expect(await getWalletQuota(prisma, user.id, NOW)).toEqual({
        count: 5,
        limit: 5,
        reached: true,
      });
    });

    it("keeps counting past the limit: wallets stay after a downgrade", async () => {
      const user = await createUser();
      await subscribe(user.id, "CLASSIC", at(DAY_MS));
      await addWallets(user.id, 6);

      expect(await getWalletQuota(prisma, user.id, NOW)).toEqual({
        count: 6,
        limit: 5,
        reached: true,
      });
    });

    it("allows 10 wallets in Premium", async () => {
      const user = await createUser();
      await subscribe(user.id, "PREMIUM", at(DAY_MS));

      expect((await getWalletQuota(prisma, user.id, NOW)).limit).toBe(10);
    });
  });

  describe("countActiveSubscribers", () => {
    it("counts users with an active plan, not the ones whose date has passed", async () => {
      const [twice, late] = [await createUser(), await createUser()];
      await subscribe(twice.id, "CLASSIC", at(-DAY_MS), "EXPIRED");
      await subscribe(twice.id, "PREMIUM", at(2 * DAY_MS));
      await subscribe(late.id, "PREMIUM", at(-HOUR_MS));

      const count = createActiveSubscriberCounter({ prisma, now: () => NOW.getTime() });

      expect(await count()).toBe(1);
    });

    it("is cached for 60 s", async () => {
      let time = NOW.getTime();
      const count = createActiveSubscriberCounter({ prisma, now: () => time });
      expect(await count()).toBe(0);

      const user = await createUser();
      await subscribe(user.id, "CLASSIC", at(DAY_MS));
      time += 59 * SECOND_MS;
      expect(await count()).toBe(0);

      time += SECOND_MS;
      expect(await count()).toBe(1);
    });
  });
});
