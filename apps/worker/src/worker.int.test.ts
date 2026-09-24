import {
  createPaymentService,
  createPrismaClient,
  createReminderService,
  createSubscriptionService,
} from "@launchbot/db";
import type { PaymentService, PrismaClient } from "@launchbot/db";
import { createTestUser, fakeChain, fundedInvoice, resetTestDatabase } from "@launchbot/db/test";
import { createUi, DAY_MS, getOffer, HOUR_MS, MINUTE_MS } from "@launchbot/shared";
import { createKeyVault, generateKeypair } from "@launchbot/solana";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoss, QUEUES } from "./boss.js";
import { createSubscriptionJobs } from "./jobs/subscriptions.js";
import { detectPayments } from "./jobs/payments.js";
import type { SendResult, TelegramSender } from "./telegram.js";

const EXPECTED = 570_820_434n;
const BASE = new Date("2026-09-17T08:00:00Z");
const at = (ms: number) => new Date(BASE.getTime() + ms);

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("worker (db + pg-boss, V1-32, V1-34)", () => {
  let prisma: PrismaClient;
  let boss: PgBoss;
  let payments: PaymentService;
  const { lamports: chain, read } = fakeChain();

  beforeAll(async () => {
    const url = await resetTestDatabase("worker");
    prisma = createPrismaClient(url);
    boss = await createBoss(url);
    await boss.createQueue(QUEUES.notifyPaid, { policy: "exclusive" });
    payments = createPaymentService({
      prisma,
      subscriptions: createSubscriptionService({ prisma }),
      getSolUsdPrice: () => Promise.resolve(null),
      readLamports: read,
      generateKeypair,
      vault: createKeyVault(new Uint8Array(32)),
    });
  }, 120_000);

  afterAll(async () => {
    await boss.stop({ graceful: false });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    chain.clear();
    await boss.deleteAllJobs();
    await prisma.subscription.deleteMany();
    await prisma.payment.deleteMany();
  });

  /** A pending invoice of 30 minutes from BASE, its deposit holding `balance`. */
  const invoice = (balance: bigint, overrides: Parameters<typeof fundedInvoice>[3] = {}) =>
    fundedInvoice(prisma, chain, balance, {
      expiresAt: at(30 * MINUTE_MS),
      createdAt: BASE,
      ...overrides,
    });

  const tick = (now: Date) =>
    detectPayments({
      payments,
      afterActivation: [
        (paymentId) => boss.send(QUEUES.notifyPaid, { paymentId }, { singletonKey: paymentId }),
      ],
      now: () => now,
    });

  const notifications = async () =>
    (await boss.fetch<{ paymentId: string }>(QUEUES.notifyPaid, { batchSize: 10 })).map(
      (job) => job.data.paymentId,
    );

  it("a full payment activates the plan and queues one « Payment received »", async () => {
    const { row, user } = await invoice(EXPECTED);

    await expect(tick(at(MINUTE_MS))).resolves.toMatchObject({ checked: 1, activated: 1 });
    await expect(tick(at(2 * MINUTE_MS))).resolves.toMatchObject({ checked: 0, activated: 0 });

    expect(await prisma.subscription.findMany({ where: { userId: user.id } })).toEqual([
      expect.objectContaining({ plan: "PREMIUM", status: "ACTIVE", paymentId: row.id }),
    ]);
    expect(await notifications()).toEqual([row.id]);
    await expect(payments.getPaidNotice(row.id, at(2 * MINUTE_MS))).resolves.toEqual({
      telegramId: user.telegramId,
      plan: "PREMIUM",
      expiresAt: at(MINUTE_MS + 2 * DAY_MS),
    });
  });

  it("a partial payment is recorded, nothing activates", async () => {
    const { row } = await invoice(300_000_000n);

    await expect(tick(at(MINUTE_MS))).resolves.toMatchObject({ partial: 1, activated: 0 });

    expect(await prisma.payment.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "PENDING",
      receivedLamports: 300_000_000n,
    });
    expect(await prisma.subscription.count()).toBe(0);
    expect(await notifications()).toEqual([]);
  });

  it("a tick and « I've paid » at the same time: one plan, the message only if the worker won", async () => {
    const { row, user } = await invoice(EXPECTED);
    const now = at(MINUTE_MS);

    const [report, check] = await Promise.all([
      tick(now),
      payments.checkInvoice(row.id, { now, userId: user.id }),
    ]);

    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(1);
    const botWon = check.kind === "ACTIVATED" && check.activatedNow;
    expect(report.activated).toBe(botWon ? 0 : 1);
    expect(await notifications()).toEqual(botWon ? [] : [row.id]);
  });

  it("a canceled invoice paid in full within its 24 h activates, not after", async () => {
    const onTime = await invoice(EXPECTED, { status: "CANCELED", canceledAt: at(MINUTE_MS) });
    const late = await invoice(EXPECTED, { status: "CANCELED", canceledAt: at(MINUTE_MS) });
    chain.set(late.row.depositAddress, 0n);

    await tick(at(23 * HOUR_MS));
    chain.set(late.row.depositAddress, EXPECTED);
    await tick(at(25 * HOUR_MS));

    expect(await prisma.subscription.count({ where: { userId: onTime.user.id } })).toBe(1);
    expect(await prisma.subscription.count({ where: { userId: late.user.id } })).toBe(0);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: late.row.id } })).toMatchObject({
      status: "CANCELED",
    });
  });

  it("a pending invoice expires at 30 minutes, read or not", async () => {
    const read = await invoice(0n);
    const unread = await invoice(0n);
    const statusOf = async (id: string) =>
      (await prisma.payment.findUniqueOrThrow({ where: { id } })).status;

    // Read: its check expires it on the way (V1-28).
    await tick(at(30 * MINUTE_MS));
    expect(await statusOf(read.row.id)).toBe("EXPIRED");

    // Unread (the RPC failed for its group): the expiry after the checks catches it.
    await prisma.payment.update({ where: { id: unread.row.id }, data: { status: "PENDING" } });
    const failing = vi.spyOn(payments, "checkInvoicesBatch").mockResolvedValueOnce(new Map());
    await expect(tick(at(31 * MINUTE_MS))).resolves.toMatchObject({ checked: 0, expired: 1 });
    failing.mockRestore();
    expect(await statusOf(unread.row.id)).toBe("EXPIRED");
  });

  describe("the plans' crons (V1-34)", () => {
    function jobs(now: Date, ...results: SendResult[]) {
      const sendScreen = vi.fn<TelegramSender["sendScreen"]>(() =>
        Promise.resolve(results.shift() ?? { ok: true, messageId: 1 }),
      );
      const subscriptions = createSubscriptionService({ prisma });
      return {
        sendScreen,
        subscriptions,
        plans: createSubscriptionJobs({
          reminders: createReminderService({ prisma }),
          subscriptions,
          telegram: { sendScreen },
          ui: createUi("devnet"),
          now: () => now,
        }),
      };
    }

    const grant = async (plan: "CLASSIC" | "PREMIUM", now: Date, userId?: string) => {
      const id = userId ?? (await createTestUser(prisma)).id;
      await createSubscriptionService({ prisma }).grantSubscription({
        userId: id,
        offer: getOffer(plan, "TWO_DAYS"),
        now,
        actorTelegramId: 1n,
      });
      return id;
    };

    it("two runs send one reminder", async () => {
      await grant("PREMIUM", BASE);
      const now = at(43 * HOUR_MS);
      const { plans, sendScreen } = jobs(now);

      await plans.remind();
      await plans.remind();

      expect(sendScreen).toHaveBeenCalledOnce();
    });

    it("a blocked bot keeps the reminder spent, a network error sends it next run", async () => {
      await grant("PREMIUM", BASE);
      await grant("CLASSIC", BASE);
      const now = at(43 * HOUR_MS);
      const { plans, sendScreen } = jobs(
        now,
        { ok: false, reason: "BLOCKED" },
        { ok: false, reason: "ERROR" },
      );

      await expect(plans.remind()).resolves.toEqual({ due: 2, sent: 0 });
      await expect(plans.remind()).resolves.toEqual({ due: 1, sent: 1 });
      expect(sendScreen).toHaveBeenCalledTimes(3);
    });

    it("a Classic replaced by a Premium is never reminded", async () => {
      const userId = await grant("CLASSIC", BASE);
      await grant("PREMIUM", at(HOUR_MS), userId);
      // The Classic would have 5 h 30 left, within its notice; the Premium 6 h 30, not yet.
      const { plans, sendScreen } = jobs(at(42 * HOUR_MS + 30 * MINUTE_MS));

      await plans.remind();

      expect(sendScreen).not.toHaveBeenCalled();
    });

    it("the expiry turns only the ACTIVE rows that ended EXPIRED", async () => {
      const ended = await grant("CLASSIC", BASE);
      const running = await grant("PREMIUM", at(DAY_MS));
      const { plans } = jobs(at(2 * DAY_MS + MINUTE_MS));

      await expect(plans.expire()).resolves.toBe(1);

      const statusOf = async (userId: string) =>
        (await prisma.subscription.findFirstOrThrow({ where: { userId } })).status;
      expect(await statusOf(ended)).toBe("EXPIRED");
      expect(await statusOf(running)).toBe("ACTIVE");
    });
  });
});
