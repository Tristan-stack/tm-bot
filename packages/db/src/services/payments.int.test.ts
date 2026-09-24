import { getOffer, HOUR_MS, MINUTE_MS } from "@launchbot/shared";
import type { Offer } from "@launchbot/shared";
import { createKeyVault, generateKeypair } from "@launchbot/solana";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PaymentStatus, PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase, testPaymentData } from "../test-db.js";
import { createPaymentService, WITHOUT_KEY } from "./payments.js";
import type { InvoiceRow, PaymentService } from "./payments.js";
import { createSubscriptionService } from "./subscriptions.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const CLASSIC_2D = getOffer("CLASSIC", "TWO_DAYS");
const PREMIUM_2D = getOffer("PREMIUM", "TWO_DAYS");
const PREMIUM_1M = getOffer("PREMIUM", "ONE_MONTH");
/** $59 at $103.36 (§8.3). */
const EXPECTED = 570_820_434n;

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("payment service (db)", () => {
  let prisma: PrismaClient;
  let service: PaymentService;
  const vault = createKeyVault(new Uint8Array(32));
  /** The fake chain: deposit balances by address, 0 when absent. */
  const chain = new Map<string, bigint>();
  /** Addresses per grouped read, in order. */
  let reads: number[] = [];
  let failingRead: number | null = null;
  let price: number | null = 103.36;

  const createUser = () => createTestUser(prisma);

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("payments"));
    service = createPaymentService({
      prisma,
      subscriptions: createSubscriptionService({ prisma }),
      getSolUsdPrice: () => Promise.resolve(price),
      readLamports: (addresses) => {
        reads.push(addresses.length);
        if (failingRead === reads.length) return Promise.reject(new Error("RPC down"));
        return Promise.resolve(new Map(addresses.map((a) => [a, chain.get(a) ?? 0n])));
      },
      generateKeypair,
      vault,
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany();
    await prisma.payment.deleteMany();
    chain.clear();
    reads = [];
    failingRead = null;
    price = 103.36;
  });

  async function newInvoice(userId: string, offer: Offer = PREMIUM_2D, now = NOW) {
    const result = await service.createInvoice({ userId, offer, now });
    if (!result.ok) throw new Error(result.error);
    return result.invoice;
  }

  const rowOf = (id: string): Promise<InvoiceRow> =>
    prisma.payment.findUniqueOrThrow({ where: { id }, omit: WITHOUT_KEY });

  const statusOf = async (id: string) => (await rowOf(id)).status;

  describe("createInvoice", () => {
    it("freezes the price of the moment for 30 minutes on a new deposit address", async () => {
      const user = await createUser();

      const result = await service.createInvoice({ userId: user.id, offer: PREMIUM_2D, now: NOW });

      expect(result).toMatchObject({
        ok: true,
        reused: false,
        invoice: {
          userId: user.id,
          offer: { code: "P2D" },
          priceUsd: "59.00",
          solUsdRate: "103.36",
          expectedLamports: EXPECTED,
          receivedLamports: 0n,
          remainingLamports: EXPECTED,
          status: "PENDING",
          expiresAt: at(30 * MINUTE_MS),
          secondsLeft: 1_800,
        },
      });
      if (!result.ok) return;
      expect(result.invoice).not.toHaveProperty("encSecretKey");
      expect(result.invoice).not.toHaveProperty("iv");
    });

    it("stores a deposit key that decrypts to the deposit address (V1-09)", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);

      const row = await prisma.payment.findUniqueOrThrow({ where: { id: invoice.id } });
      const { encSecretKey, iv, authTag } = row;
      if (encSecretKey === null || iv === null || authTag === null) throw new Error("no key");
      const signed = await vault.withSigner(
        { encSecretKey, iv, authTag },
        invoice.depositAddress,
        (signer) => Promise.resolve(signer.publicKey.toBase58()),
      );

      expect(signed).toBe(invoice.depositAddress);
    });

    it("hands back the pending invoice of the same offer, never of another one", async () => {
      const user = await createUser();
      const first = await newInvoice(user.id, PREMIUM_2D);

      const again = await service.createInvoice({
        userId: user.id,
        offer: PREMIUM_2D,
        now: at(10 * MINUTE_MS),
      });
      const other = await newInvoice(user.id, PREMIUM_1M);

      expect(again).toMatchObject({
        ok: true,
        reused: true,
        invoice: { id: first.id, secondsLeft: 1_200 },
      });
      expect(other.depositAddress).not.toBe(first.depositAddress);
      expect(await prisma.payment.count({ where: { userId: user.id } })).toBe(2);
    });

    it("creates nothing without a SOL price", async () => {
      const user = await createUser();
      price = null;

      expect(await service.createInvoice({ userId: user.id, offer: PREMIUM_2D, now: NOW })).toEqual(
        {
          ok: false,
          error: "PRICE_UNAVAILABLE",
        },
      );
      expect(await prisma.payment.count()).toBe(0);
    });

    it("refuses Classic during Premium (V1-27)", async () => {
      const user = await createUser();
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "PREMIUM",
          duration: "ONE_MONTH",
          startsAt: NOW,
          expiresAt: at(HOUR_MS),
        },
      });

      expect(await service.createInvoice({ userId: user.id, offer: CLASSIC_2D, now: NOW })).toEqual(
        {
          ok: false,
          error: "PLAN_SWITCH_REFUSED",
        },
      );
      expect(await prisma.payment.count()).toBe(0);
    });

    it("limits a user to 5 new invoices per 10 minutes (D17)", async () => {
      const user = await createUser();
      for (let index = 0; index < 5; index++) {
        const invoice = await newInvoice(user.id);
        await service.cancelInvoice(invoice.id, user.id, NOW);
      }

      expect(await service.createInvoice({ userId: user.id, offer: PREMIUM_2D, now: NOW })).toEqual(
        {
          ok: false,
          error: "RATE_LIMITED",
        },
      );
      const later = await service.createInvoice({
        userId: user.id,
        offer: PREMIUM_2D,
        now: at(10 * MINUTE_MS + 1),
      });
      expect(later).toMatchObject({ ok: true, reused: false });
    });
  });

  describe("checkInvoice", () => {
    const check = (id: string, userId: string, now = NOW) =>
      service.checkInvoice(id, { now, userId });

    it("reports nothing received yet", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);

      expect(await check(invoice.id, user.id)).toMatchObject({
        kind: "NOT_DETECTED",
        checkedAt: NOW,
      });
    });

    it("reports a partial payment with the exact rest, and stores what was received", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);
      chain.set(invoice.depositAddress, 300_000_000n);

      expect(await check(invoice.id, user.id)).toMatchObject({
        kind: "PARTIAL",
        invoice: { receivedLamports: 300_000_000n, remainingLamports: EXPECTED - 300_000_000n },
      });
      expect((await rowOf(invoice.id)).receivedLamports).toBe(300_000_000n);
      expect(await prisma.subscription.count()).toBe(0);
    });

    it("activates a full payment once, then reads nothing on the chain", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);
      chain.set(invoice.depositAddress, EXPECTED);

      expect(await check(invoice.id, user.id)).toMatchObject({
        kind: "ACTIVATED",
        activatedNow: true,
        plan: "PREMIUM",
        expiresAt: at(48 * HOUR_MS),
        invoice: { status: "PAID", receivedLamports: EXPECTED, remainingLamports: 0n },
      });
      expect(await check(invoice.id, user.id, at(MINUTE_MS))).toMatchObject({
        kind: "ACTIVATED",
        activatedNow: false,
        expiresAt: at(48 * HOUR_MS),
      });
      expect(reads).toEqual([1]);
      expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(1);
    });

    it("activates a surplus, which is not refunded", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);
      chain.set(invoice.depositAddress, EXPECTED + 50_000_000n);

      expect(await check(invoice.id, user.id)).toMatchObject({
        kind: "ACTIVATED",
        activatedNow: true,
      });
    });

    it("accepts a full payment up to 24 h after the expiry, not after", async () => {
      const user = await createUser();
      const [onTime, late] = [
        await newInvoice(user.id, PREMIUM_2D),
        await newInvoice(user.id, PREMIUM_1M),
      ];
      chain.set(onTime.depositAddress, onTime.expectedLamports);
      chain.set(late.depositAddress, late.expectedLamports);
      const expiry = 30 * MINUTE_MS;

      expect(await check(onTime.id, user.id, at(expiry + 24 * HOUR_MS - MINUTE_MS))).toMatchObject({
        kind: "ACTIVATED",
      });
      expect(await check(late.id, user.id, at(expiry + 24 * HOUR_MS + MINUTE_MS))).toMatchObject({
        kind: "LATE_FULL_PAYMENT",
        invoice: { status: "EXPIRED" },
      });
      expect(await statusOf(late.id)).toBe("EXPIRED");
    });

    it("accepts a full payment within 24 h of a cancellation", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);
      await service.cancelInvoice(invoice.id, user.id, at(5 * MINUTE_MS));
      chain.set(invoice.depositAddress, EXPECTED);

      expect(await check(invoice.id, user.id, at(23 * HOUR_MS))).toMatchObject({
        kind: "ACTIVATED",
        activatedNow: true,
      });
    });

    it("reports a partial payment on an expired invoice", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);
      chain.set(invoice.depositAddress, 1_000n);

      expect(await check(invoice.id, user.id, at(HOUR_MS))).toMatchObject({
        kind: "PARTIAL_EXPIRED",
      });
    });

    it("expires a PENDING invoice past its 30 minutes", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);

      expect(await check(invoice.id, user.id, at(31 * MINUTE_MS))).toMatchObject({
        kind: "EXPIRED",
        invoice: { secondsLeft: 0 },
      });
      expect(await statusOf(invoice.id)).toBe("EXPIRED");
    });

    it("finds neither someone else's invoice nor a made-up id", async () => {
      const [owner, other] = [await createUser(), await createUser()];
      const invoice = await newInvoice(owner.id);

      expect(await check(invoice.id, other.id)).toEqual({ kind: "NOT_FOUND", checkedAt: NOW });
      expect(await check("not-an-id", owner.id)).toEqual({ kind: "NOT_FOUND", checkedAt: NOW });
      expect(reads).toEqual([]);
    });

    it("activates nothing for a purged account: ORPHAN_PAYMENT", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);
      await prisma.payment.update({ where: { id: invoice.id }, data: { userId: null } });
      chain.set(invoice.depositAddress, EXPECTED);

      expect(await service.checkInvoice(invoice.id, { now: NOW })).toMatchObject({
        kind: "ORPHAN_PAYMENT",
        invoice: { receivedLamports: EXPECTED },
      });
      expect(await statusOf(invoice.id)).toBe("PENDING");
    });
  });

  describe("concurrency (§15)", () => {
    it("activates once when two clicks and the worker check the same payment", async () => {
      for (let round = 0; round < 20; round++) {
        const user = await createUser();
        const invoice = await newInvoice(user.id);
        chain.set(invoice.depositAddress, EXPECTED);
        const row = await rowOf(invoice.id);

        const [first, second, batch] = await Promise.all([
          service.checkInvoice(invoice.id, { now: NOW, userId: user.id }),
          service.checkInvoice(invoice.id, { now: NOW, userId: user.id }),
          service.checkInvoicesBatch([row], NOW),
        ]);
        const outcomes = [first, second, batch.get(invoice.id)];

        expect(outcomes.map((outcome) => outcome?.kind)).toEqual([
          "ACTIVATED",
          "ACTIVATED",
          "ACTIVATED",
        ]);
        const activatedNow = outcomes.filter(
          (outcome) => outcome?.kind === "ACTIVATED" && outcome.activatedNow,
        );
        expect(activatedNow).toHaveLength(1);
        expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(1);
      }
    }, 60_000);
  });

  describe("checkInvoicesBatch", () => {
    async function batchRows(count: number): Promise<InvoiceRow[]> {
      const user = await createUser();
      await prisma.payment.createMany({
        data: Array.from({ length: count }, (_, index) =>
          testPaymentData(user.id, `BATCH_${index}`, { expiresAt: at(30 * MINUTE_MS) }),
        ),
      });
      return prisma.payment.findMany({ orderBy: { depositAddress: "asc" }, omit: WITHOUT_KEY });
    }

    it("reads 250 deposits in 3 grouped calls", async () => {
      const rows = await batchRows(250);

      const checks = await service.checkInvoicesBatch(rows, NOW);

      expect(reads).toEqual([100, 100, 50]);
      expect(checks.size).toBe(250);
      expect([...checks.values()].every((check) => check.kind === "NOT_DETECTED")).toBe(true);
    });

    it("leaves out the invoices of a read that failed, and decides the others", async () => {
      const rows = await batchRows(250);
      failingRead = 2;
      const funded = rows[0];
      if (funded !== undefined) chain.set(funded.depositAddress, EXPECTED);

      const checks = await service.checkInvoicesBatch(rows, NOW);

      expect(checks.size).toBe(150);
      expect(funded !== undefined && checks.get(funded.id)?.kind).toBe("ACTIVATED");
      expect(rows.slice(100, 200).some((row) => checks.has(row.id))).toBe(false);
    });
  });

  describe("listInvoicesToCheck", () => {
    it("lists what can still activate: PENDING, and EXPIRED or CANCELED within 24 h", async () => {
      const user = await createUser();
      const row = async (status: PaymentStatus, expiresAt: Date, canceledAt: Date | null = null) =>
        (
          await prisma.payment.create({
            data: testPaymentData(
              user.id,
              `LIST_${status}_${expiresAt.getTime()}_${canceledAt?.getTime() ?? 0}`,
              { status, expiresAt, canceledAt },
            ),
          })
        ).id;
      // An invoice is canceled while it is open: 10 minutes before its expiry here.
      const listed = [
        await row("PENDING", at(10 * MINUTE_MS)),
        await row("EXPIRED", at(-23 * HOUR_MS)),
        await row("CANCELED", at(-23 * HOUR_MS + 10 * MINUTE_MS), at(-23 * HOUR_MS)),
      ];
      await row("EXPIRED", at(-25 * HOUR_MS));
      await row("CANCELED", at(-25 * HOUR_MS + 10 * MINUTE_MS), at(-25 * HOUR_MS));
      await row("PAID", at(10 * MINUTE_MS));
      await row("SWEPT", at(10 * MINUTE_MS));

      const ids = (await service.listInvoicesToCheck(NOW)).map((invoice) => invoice.id);

      expect(ids.sort()).toEqual(listed.sort());
    });
  });

  describe("cancelInvoice", () => {
    it("cancels a pending invoice once", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);

      expect(await service.cancelInvoice(invoice.id, user.id, at(MINUTE_MS))).toBe("CANCELED");
      expect(await rowOf(invoice.id)).toMatchObject({
        status: "CANCELED",
        canceledAt: at(MINUTE_MS),
      });
      expect(await service.cancelInvoice(invoice.id, user.id, at(MINUTE_MS))).toBe("NOOP");
    });

    it("says a paid invoice is paid", async () => {
      const user = await createUser();
      const invoice = await newInvoice(user.id);
      chain.set(invoice.depositAddress, EXPECTED);
      await service.checkInvoice(invoice.id, { now: NOW, userId: user.id });

      expect(await service.cancelInvoice(invoice.id, user.id, NOW)).toBe("ALREADY_PAID");
    });

    it("leaves an expired invoice alone, and someone else's", async () => {
      const [owner, other] = [await createUser(), await createUser()];
      const invoice = await newInvoice(owner.id);

      expect(await service.cancelInvoice(invoice.id, other.id, NOW)).toBe("NOT_FOUND");
      expect(await service.cancelInvoice(invoice.id, owner.id, at(HOUR_MS))).toBe("NOOP");
      expect(await statusOf(invoice.id)).toBe("EXPIRED");
    });
  });

  describe("getInvoice and expireDueInvoices", () => {
    it("reads the invoice of its owner only", async () => {
      const [owner, other] = [await createUser(), await createUser()];
      const invoice = await newInvoice(owner.id);

      expect(await service.getInvoice(invoice.id, owner.id, at(MINUTE_MS))).toMatchObject({
        id: invoice.id,
        secondsLeft: 1_740,
      });
      expect(await service.getInvoice(invoice.id, other.id, NOW)).toBeNull();
    });

    it("expires the PENDING invoices past their 30 minutes, once", async () => {
      const user = await createUser();
      const [first, second] = [
        await newInvoice(user.id, PREMIUM_2D),
        await newInvoice(user.id, PREMIUM_1M),
      ];
      await newInvoice(user.id, CLASSIC_2D, at(20 * MINUTE_MS));

      expect(await service.expireDueInvoices(at(30 * MINUTE_MS))).toBe(2);
      expect(await service.expireDueInvoices(at(30 * MINUTE_MS))).toBe(0);
      expect([await statusOf(first.id), await statusOf(second.id)]).toEqual(["EXPIRED", "EXPIRED"]);
    });
  });
});
