import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from "@launchbot/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createTestUser,
  fakeChain,
  resetTestDatabase,
  testPaymentData,
  testWalletData,
} from "../test-db.js";
import { createAccountDeletionService } from "./account-deletion.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
/** At least the fees of a transfer, as `getWithdrawFeeBudgetLamports` is. */
const FEE_BUDGET = 20_000n;
const MAIN = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TEST = "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81";

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("account deletion (db, V1-44)", () => {
  let prisma: PrismaClient;
  const { lamports: chain, read } = fakeChain();
  let failRead = false;
  let deposits = 0;

  const service = () =>
    createAccountDeletionService({
      prisma,
      readLamports: (addresses) =>
        failRead ? Promise.reject(new Error("RPC down")) : read(addresses),
      feeBudgetLamports: FEE_BUDGET,
      now: () => NOW,
    });

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("deletion"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    chain.clear();
    failRead = false;
  });

  const wallet = async (userId: string, name: string, address: string, lamports: bigint) => {
    chain.set(address, lamports);
    return prisma.wallet.create({ data: testWalletData(userId, name, address) });
  };

  /** Created a second apart, in the order of the test: the blockers come in that order. */
  const invoice = (userId: string, overrides: Parameters<typeof testPaymentData>[2] = {}) => {
    const index = deposits++;
    return prisma.payment.create({
      data: testPaymentData(userId, `DEPOSIT_DEL_${index}`, {
        createdAt: at(-HOUR_MS + index * SECOND_MS),
        ...overrides,
      }),
    });
  };

  describe("getDeletionBlockers", () => {
    it("a balance above the fees of a withdrawal blocks, dust does not", async () => {
      const user = await createTestUser(prisma);
      const main = await wallet(user.id, "Main", MAIN, 2_500_000_000n);
      await wallet(user.id, "Test", TEST, FEE_BUDGET);

      expect(await service().getDeletionBlockers(user.id)).toEqual([
        { kind: "WALLET_FUNDS", walletId: main.id, name: "Main", lamports: 2_500_000_000n },
      ]);
    });

    it("an RPC failure blocks: never a purge without the balances", async () => {
      const user = await createTestUser(prisma);
      await wallet(user.id, "Main", MAIN, 0n);
      failRead = true;

      expect(await service().getDeletionBlockers(user.id)).toEqual([
        { kind: "BALANCES_UNAVAILABLE" },
      ]);
    });

    it("a pending invoice blocks, an ended one within its 24 h too, not after", async () => {
      const user = await createTestUser(prisma);
      const pending = await invoice(user.id, { expiresAt: at(20 * MINUTE_MS) });
      const expired = await invoice(user.id, { status: "EXPIRED", expiresAt: at(-23 * HOUR_MS) });
      await invoice(user.id, { status: "EXPIRED", expiresAt: at(-25 * HOUR_MS) });
      const canceled = await invoice(user.id, {
        status: "CANCELED",
        expiresAt: at(10 * MINUTE_MS),
        canceledAt: at(-HOUR_MS),
      });
      // PENDING in the table, but its 30 minutes are over: EXPIRED, still payable.
      const stale = await invoice(user.id, { expiresAt: at(-MINUTE_MS) });
      await invoice(user.id, { status: "PAID", expiresAt: at(-MINUTE_MS) });

      const blockers = await service().getDeletionBlockers(user.id);

      expect(blockers.map((blocker) => blocker.kind === "PENDING_INVOICE" && blocker)).toEqual(
        [
          { payment: pending, status: "PENDING", until: at(20 * MINUTE_MS + DAY_MS) },
          { payment: expired, status: "EXPIRED", until: at(-23 * HOUR_MS + DAY_MS) },
          { payment: canceled, status: "CANCELED", until: at(-HOUR_MS + DAY_MS) },
          { payment: stale, status: "EXPIRED", until: at(-MINUTE_MS + DAY_MS) },
        ].map(({ payment, status, until }): unknown =>
          expect.objectContaining({
            kind: "PENDING_INVOICE",
            paymentId: payment.id,
            status,
            payableUntil: until,
          }),
        ),
      );
    });

    it("an active subscription does not block", async () => {
      const user = await createTestUser(prisma);
      await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "PREMIUM",
          duration: "ONE_MONTH",
          startsAt: at(-DAY_MS),
          expiresAt: at(DAY_MS),
        },
      });

      expect(await service().getDeletionBlockers(user.id)).toEqual([]);
    });
  });

  describe("getPurgeSummary", () => {
    it("reads the account by its Telegram id, with its plan, wallets and invoices", async () => {
      const user = await createTestUser(prisma);
      await wallet(user.id, "Main", MAIN, 1_000n);

      const summary = await service().getPurgeSummary(user.telegramId);

      expect(summary).toMatchObject({
        user: { id: user.id },
        plan: { kind: "NONE" },
        wallets: [{ name: "Main", publicKey: MAIN, lamports: 1_000n }],
        invoices: [],
        blockers: [],
      });
      expect(await service().getPurgeSummary(999_999_999n)).toBeNull();
    });
  });

  describe("deleteUserData", () => {
    async function fullAccount() {
      const user = await createTestUser(prisma);
      const main = await wallet(user.id, "Main", MAIN, 0n);
      const draft = await prisma.tokenDraft.create({ data: { userId: user.id, name: "Otter" } });
      await prisma.simulation.create({
        data: { userId: user.id, tokenDraftId: draft.id, devBuySol: 1, seed: 1, params: {} },
      });
      await prisma.aiGeneration.create({ data: { userId: user.id, kind: "TEXT" } });
      const subscription = await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: "PREMIUM",
          duration: "TWO_DAYS",
          startsAt: at(-DAY_MS),
          expiresAt: at(DAY_MS),
        },
      });
      await prisma.subscriptionGrant.create({
        data: {
          nonce: `grant-${user.id}`,
          adminTelegramId: 42n,
          userId: user.id,
          subscriptionId: subscription.id,
          plan: "PREMIUM",
          duration: "TWO_DAYS",
          kind: "NEW",
          expiresAt: at(DAY_MS),
        },
      });
      const payment = await invoice(user.id, { status: "SWEPT" });
      const withdrawal = await prisma.withdrawal.create({
        data: {
          userId: user.id,
          walletId: main.id,
          fromAddress: MAIN,
          toAddress: TEST,
          lamports: 1_000n,
          status: "CONFIRMED",
        },
      });
      const sweep = await prisma.withdrawal.create({
        data: {
          userId: user.id,
          walletId: main.id,
          fromAddress: MAIN,
          toAddress: TEST,
          lamports: 2_000n,
          status: "CONFIRMED",
          kind: "INACTIVITY_SWEEP",
          userTelegramId: user.telegramId,
        },
      });
      const chat = user.telegramId.toString();
      await prisma.session.createMany({
        data: [
          { key: chat, value: "{}" },
          { key: `conversation-${chat}`, value: "{}" },
        ],
      });
      return { user, payment, withdrawal, sweep };
    }

    it("deletes the account and its data, keeps the books detached", async () => {
      const { user, payment, withdrawal, sweep } = await fullAccount();
      const other = await fullAccount();

      const result = await service().deleteUserData(user.id);

      expect(result).toEqual({
        status: "DELETED",
        counts: {
          wallets: 1,
          drafts: 1,
          simulations: 1,
          aiGenerations: 1,
          subscriptions: 1,
          payments: 1,
          withdrawals: 2,
        },
      });
      const where = { userId: user.id };
      expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
      for (const count of [
        prisma.wallet.count({ where }),
        prisma.tokenDraft.count({ where }),
        prisma.simulation.count({ where }),
        prisma.aiGeneration.count({ where }),
        prisma.subscription.count({ where }),
      ]) {
        expect(await count).toBe(0);
      }
      expect(
        await prisma.session.count({ where: { key: { contains: user.telegramId.toString() } } }),
      ).toBe(0);
      expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
        userId: null,
        status: "SWEPT",
      });
      expect(
        await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } }),
      ).toMatchObject({ userId: null, walletId: null });
      expect(await prisma.withdrawal.findUniqueOrThrow({ where: { id: sweep.id } })).toMatchObject({
        userId: null,
        walletId: null,
        userTelegramId: user.telegramId,
      });
      expect(
        await prisma.subscriptionGrant.findUniqueOrThrow({
          where: { nonce: `grant-${user.id}` },
        }),
      ).toMatchObject({ userId: null, subscriptionId: null });
      // The other account is untouched.
      expect(await prisma.wallet.count({ where: { userId: other.user.id } })).toBe(1);
      expect(await prisma.session.count({ where: { key: other.user.telegramId.toString() } })).toBe(
        1,
      );

      expect(await service().deleteUserData(user.id)).toEqual({ status: "NOT_FOUND" });
    });

    it("keeps an account active since the date given (V1-45)", async () => {
      const user = await prisma.user.create({
        data: { telegramId: 8_800_000n, lastActiveAt: at(-HOUR_MS) },
      });

      expect(
        await service().deleteUserData(user.id, { onlyIfLastActiveBefore: at(-2 * HOUR_MS) }),
      ).toEqual({ status: "SKIPPED_ACTIVE" });
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);

      expect(
        await service().deleteUserData(user.id, { onlyIfLastActiveBefore: at(-MINUTE_MS) }),
      ).toMatchObject({ status: "DELETED" });
    });
  });
});
