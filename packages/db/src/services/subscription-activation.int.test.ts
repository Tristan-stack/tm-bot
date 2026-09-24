import { DAY_MS, getOffer, HOUR_MS, MINUTE_MS } from "@launchbot/shared";
import type { Offer } from "@launchbot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type {
  PaymentStatus,
  Plan,
  PrismaClient,
  SubscriptionStatus,
} from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase, testPaymentData } from "../test-db.js";
import {
  createSubscriptionService,
  getPlanStatus,
  hasActivePremium,
  hasActiveSubscription,
} from "./subscriptions.js";
import type { ActivationResult, SubscriptionService } from "./subscriptions.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const CLASSIC_2D = getOffer("CLASSIC", "TWO_DAYS");
const PREMIUM_2D = getOffer("PREMIUM", "TWO_DAYS");
const PREMIUM_1M = getOffer("PREMIUM", "ONE_MONTH");

const statuses = (results: ActivationResult[]) => results.map((result) => result.status).sort();

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("subscription activation (db)", () => {
  let prisma: PrismaClient;
  let service: SubscriptionService;
  let deposits = 0;
  const createUser = () => createTestUser(prisma);

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("activation"));
    service = createSubscriptionService({ prisma });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const invoice = (userId: string | null, offer: Offer, status: PaymentStatus = "PENDING") =>
    prisma.payment.create({
      data: testPaymentData(userId, `DEPOSIT_${deposits++}`, {
        plan: offer.plan,
        duration: offer.duration,
        status,
        expiresAt: at(30 * MINUTE_MS),
      }),
    });

  const subscribe = (
    userId: string,
    plan: Plan,
    expiresAt: Date,
    options: { duration?: "TWO_DAYS" | "ONE_MONTH"; status?: SubscriptionStatus } = {},
  ) =>
    prisma.subscription.create({
      data: {
        userId,
        plan,
        duration: options.duration ?? "ONE_MONTH",
        status: options.status ?? "ACTIVE",
        startsAt: at(-10 * DAY_MS),
        expiresAt,
      },
    });

  const rowsOf = (userId: string) =>
    prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  describe("activateFromPayment: once per invoice (§8.3, §15)", () => {
    it("activates one invoice once, whatever the parallel detections (50 rounds)", async () => {
      for (let round = 0; round < 50; round++) {
        const user = await createUser();
        // Even rounds start a plan, odd rounds extend one: both must happen exactly once.
        const extending = round % 2 === 1;
        if (extending) await subscribe(user.id, "PREMIUM", at(DAY_MS));
        const payment = await invoice(user.id, PREMIUM_2D);
        const callers = 2 + (round % 4);

        const results = await Promise.all(
          Array.from({ length: callers }, () => service.activateFromPayment(payment.id, NOW)),
        );

        const expiresAt = extending ? at(DAY_MS + 48 * HOUR_MS) : at(48 * HOUR_MS);
        expect(statuses(results)).toEqual([
          "ACTIVATED",
          ...Array<string>(callers - 1).fill("ALREADY_ACTIVATED"),
        ]);
        const activated = results.find((result) => result.status === "ACTIVATED");
        expect(activated?.subscription.expiresAt).toEqual(expiresAt);
        expect(await rowsOf(user.id)).toMatchObject([{ status: "ACTIVE", expiresAt }]);
      }
    }, 120_000);

    it("adds up two invoices of one user paid at the same time", async () => {
      for (let round = 0; round < 10; round++) {
        const user = await createUser();
        const [first, second] = [
          await invoice(user.id, PREMIUM_2D),
          await invoice(user.id, PREMIUM_1M),
        ];

        const results = await Promise.all([
          service.activateFromPayment(first.id, NOW),
          service.activateFromPayment(second.id, NOW),
        ]);

        const kinds = results.map((result) => (result.status === "ACTIVATED" ? result.kind : null));
        expect(kinds.sort()).toEqual(["EXTEND", "NEW"]);
        expect(await rowsOf(user.id)).toMatchObject([
          { status: "ACTIVE", expiresAt: at(48 * HOUR_MS + 30 * DAY_MS) },
        ]);
      }
    }, 60_000);

    it("marks the invoice PAID at the activation", async () => {
      const user = await createUser();
      const payment = await invoice(user.id, PREMIUM_2D);

      const result = await service.activateFromPayment(payment.id, NOW);

      expect(result).toMatchObject({
        status: "ACTIVATED",
        kind: "NEW",
        subscription: { plan: "PREMIUM", duration: "TWO_DAYS", startsAt: NOW },
      });
      expect(await prisma.payment.findUnique({ where: { id: payment.id } })).toMatchObject({
        status: "PAID",
        paidAt: NOW,
      });
      expect(await rowsOf(user.id)).toMatchObject([{ paymentId: payment.id }]);
    });

    it.each<PaymentStatus>(["EXPIRED", "CANCELED"])(
      "activates a %s invoice: a full payment is accepted 24 h late",
      async (status) => {
        const user = await createUser();
        const payment = await invoice(user.id, PREMIUM_2D, status);

        expect(await service.activateFromPayment(payment.id, NOW)).toMatchObject({
          status: "ACTIVATED",
        });
      },
    );

    it.each<PaymentStatus>(["PAID", "SWEPT"])("writes nothing for a %s invoice", async (status) => {
      const user = await createUser();
      const payment = await invoice(user.id, PREMIUM_2D, status);

      expect(await service.activateFromPayment(payment.id, NOW)).toEqual({
        status: "ALREADY_ACTIVATED",
      });
      expect(await rowsOf(user.id)).toEqual([]);
      expect(await prisma.payment.findUnique({ where: { id: payment.id } })).toMatchObject({
        status,
        paidAt: null,
      });
    });

    it("activates nothing for a purged account (userId null)", async () => {
      const payment = await invoice(null, PREMIUM_2D);

      expect(await service.activateFromPayment(payment.id, NOW)).toEqual({
        status: "USER_DELETED",
      });
      expect(await prisma.payment.findUnique({ where: { id: payment.id } })).toMatchObject({
        status: "PENDING",
      });
    });

    it("refuses an unknown invoice", async () => {
      await expect(service.activateFromPayment("unknown", NOW)).rejects.toThrow("Unknown payment");
    });

    it("UPGRADE: the Classic ends now, the Premium starts now", async () => {
      const user = await createUser();
      const classic = await subscribe(user.id, "CLASSIC", at(20 * DAY_MS));
      const payment = await invoice(user.id, PREMIUM_1M);

      expect(await service.activateFromPayment(payment.id, NOW)).toMatchObject({
        status: "ACTIVATED",
        kind: "UPGRADE",
      });
      expect(await rowsOf(user.id)).toMatchObject([
        { id: classic.id, plan: "CLASSIC", status: "EXPIRED", expiresAt: NOW },
        {
          plan: "PREMIUM",
          status: "ACTIVE",
          startsAt: NOW,
          expiresAt: at(30 * DAY_MS),
          paymentId: payment.id,
        },
      ]);
    });

    it("EXTEND_PREMIUM: a Classic paid during Premium extends the Premium", async () => {
      const user = await createUser();
      await subscribe(user.id, "PREMIUM", at(DAY_MS));
      const payment = await invoice(user.id, CLASSIC_2D);

      expect(await service.activateFromPayment(payment.id, NOW)).toMatchObject({
        status: "ACTIVATED",
        kind: "EXTEND_PREMIUM",
        subscription: { plan: "PREMIUM", expiresAt: at(DAY_MS + 48 * HOUR_MS) },
      });
      expect(await rowsOf(user.id)).toHaveLength(1);
    });

    it("records the duration of the last pass on an extension (V1-34 notice)", async () => {
      const user = await createUser();
      await subscribe(user.id, "PREMIUM", at(5 * HOUR_MS), { duration: "TWO_DAYS" });
      const payment = await invoice(user.id, PREMIUM_1M);

      await service.activateFromPayment(payment.id, NOW);

      expect(await rowsOf(user.id)).toMatchObject([
        { duration: "ONE_MONTH", expiresAt: at(5 * HOUR_MS + 30 * DAY_MS) },
      ]);
    });

    it("expires an ACTIVE row that ended, then starts a new plan", async () => {
      const user = await createUser();
      const ended = await subscribe(user.id, "PREMIUM", at(-HOUR_MS));
      const payment = await invoice(user.id, CLASSIC_2D);

      expect(await service.activateFromPayment(payment.id, NOW)).toMatchObject({
        status: "ACTIVATED",
        kind: "NEW",
      });
      expect(await rowsOf(user.id)).toMatchObject([
        { id: ended.id, status: "EXPIRED" },
        { plan: "CLASSIC", status: "ACTIVE" },
      ]);
    });

    it("runs inside the caller's transaction, and rolls back with it", async () => {
      const user = await createUser();
      const payment = await invoice(user.id, PREMIUM_2D);

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: { id: payment.id },
            data: { receivedLamports: 570_820_434n },
          });
          await service.activateFromPayment(payment.id, NOW, tx);
          throw new Error("caller failed");
        }),
      ).rejects.toThrow("caller failed");
      expect(await rowsOf(user.id)).toEqual([]);

      const result = await prisma.$transaction((tx) =>
        service.activateFromPayment(payment.id, NOW, tx),
      );
      expect(result).toMatchObject({ status: "ACTIVATED" });
    });
  });

  describe("grantSubscription (/grant)", () => {
    const grant = (userId: string, offer: Offer) =>
      service.grantSubscription({ userId, offer, now: NOW, actorTelegramId: 42n });

    it("starts a plan without an invoice", async () => {
      const user = await createUser();

      expect(await grant(user.id, PREMIUM_2D)).toMatchObject({ status: "ACTIVATED", kind: "NEW" });
      expect(await rowsOf(user.id)).toMatchObject([{ paymentId: null, status: "ACTIVE" }]);
    });

    it("is extended by a payment of the same plan", async () => {
      const user = await createUser();
      await grant(user.id, PREMIUM_2D);
      const payment = await invoice(user.id, PREMIUM_1M);

      expect(await service.activateFromPayment(payment.id, NOW)).toMatchObject({
        kind: "EXTEND",
        subscription: { expiresAt: at(48 * HOUR_MS + 30 * DAY_MS) },
      });
    });

    it("refuses Classic during Premium and writes nothing", async () => {
      const user = await createUser();
      await subscribe(user.id, "PREMIUM", at(DAY_MS));

      expect(await grant(user.id, CLASSIC_2D)).toEqual({ status: "REFUSED" });
      expect(await rowsOf(user.id)).toMatchObject([{ plan: "PREMIUM", expiresAt: at(DAY_MS) }]);
    });

    it("reports a user that no longer exists", async () => {
      expect(await grant("missing-user", PREMIUM_2D)).toEqual({ status: "USER_DELETED" });
    });

    it("previews the end date without writing", async () => {
      const user = await createUser();
      await subscribe(user.id, "CLASSIC", at(DAY_MS));

      expect(await service.previewGrant(user.id, CLASSIC_2D, NOW)).toMatchObject({
        kind: "EXTEND",
        expiresAt: at(DAY_MS + 48 * HOUR_MS),
      });
      expect(await rowsOf(user.id)).toMatchObject([{ expiresAt: at(DAY_MS) }]);
    });
  });

  describe("expireDueSubscriptions", () => {
    it("expires the ACTIVE rows that ended, once", async () => {
      await prisma.subscription.updateMany({ data: { status: "EXPIRED" } });
      const [a, b, c] = [await createUser(), await createUser(), await createUser()];
      const due = await subscribe(a.id, "CLASSIC", NOW);
      const late = await subscribe(b.id, "PREMIUM", at(-DAY_MS));
      await subscribe(c.id, "PREMIUM", at(HOUR_MS));

      const expired = await service.expireDueSubscriptions(NOW);

      expect(expired.sort((x, y) => x.plan.localeCompare(y.plan))).toEqual([
        { id: due.id, userId: a.id, plan: "CLASSIC" },
        { id: late.id, userId: b.id, plan: "PREMIUM" },
      ]);
      expect(await service.expireDueSubscriptions(NOW)).toEqual([]);
      expect(await rowsOf(c.id)).toMatchObject([{ status: "ACTIVE" }]);
    });
  });

  describe("reads", () => {
    it("reports no plan, then the active one, then the plan that expired", async () => {
      const user = await createUser();
      expect(await getPlanStatus(prisma, user.id, NOW)).toEqual({ kind: "NONE" });
      expect(await hasActiveSubscription(prisma, user.id, NOW)).toBe(false);

      const premium = await subscribe(user.id, "PREMIUM", at(DAY_MS));
      expect(await getPlanStatus(prisma, user.id, NOW)).toMatchObject({
        kind: "ACTIVE",
        subscription: { id: premium.id, plan: "PREMIUM" },
      });
      expect(await hasActiveSubscription(prisma, user.id, NOW)).toBe(true);
      expect(await hasActivePremium(prisma, user.id, NOW)).toBe(true);

      expect(await getPlanStatus(prisma, user.id, at(DAY_MS))).toMatchObject({
        kind: "EXPIRED",
        subscription: { id: premium.id, plan: "PREMIUM" },
      });
      expect(await hasActivePremium(prisma, user.id, at(DAY_MS))).toBe(false);
    });
  });
});
