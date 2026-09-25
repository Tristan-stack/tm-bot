import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from "@launchbot/shared";
import { createKeyVault, generateMnemonicWallet, revealWalletSecrets } from "@launchbot/solana";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase, testPaymentData, testWalletData } from "../test-db.js";
import { createSensitiveMessageStore } from "./sensitive-messages.js";
import { createSupportDataService } from "./support-data.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const MAIN = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TEST = "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81";
const KEY_COLUMNS = [
  "encSecretKey",
  "iv",
  "authTag",
  "encMnemonic",
  "mnemonicIv",
  "mnemonicAuthTag",
];

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("support data (db, V1-43)", () => {
  let prisma: PrismaClient;
  let deposits = 0;

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("support"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const service = () => createSupportDataService({ prisma });

  it("reads what /whois and /getall show, never a key column", async () => {
    const user = await createTestUser(prisma);
    const main = await prisma.wallet.create({
      data: { ...testWalletData(user.id, "Main", MAIN), createdAt: at(-3 * DAY_MS) },
    });
    await prisma.wallet.create({
      data: {
        ...testWalletData(user.id, "Test", TEST),
        source: "IMPORTED_KEY",
        createdAt: at(-2 * DAY_MS),
      },
    });
    // A Classic granted then a Premium paid, active.
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "CLASSIC",
        duration: "TWO_DAYS",
        status: "EXPIRED",
        startsAt: at(-5 * DAY_MS),
        expiresAt: at(-3 * DAY_MS),
      },
    });
    const paid = await prisma.payment.create({
      data: testPaymentData(user.id, `DEPOSIT_SUP_${deposits++}`, {
        status: "SWEPT",
        expiresAt: at(-DAY_MS),
        createdAt: at(-DAY_MS - HOUR_MS),
      }),
    });
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "PREMIUM",
        duration: "ONE_MONTH",
        startsAt: at(-DAY_MS),
        expiresAt: at(29 * DAY_MS),
        paymentId: paid.id,
      },
    });
    // PENDING in the table, 30 minutes over: read as EXPIRED.
    await prisma.payment.create({
      data: testPaymentData(user.id, `DEPOSIT_SUP_${deposits++}`, {
        receivedLamports: 200_000_000n,
        expiresAt: at(-MINUTE_MS),
        createdAt: at(-HOUR_MS),
      }),
    });
    await prisma.withdrawal.create({
      data: {
        userId: user.id,
        walletId: main.id,
        fromAddress: MAIN,
        toAddress: TEST,
        lamports: 500_000_000n,
        status: "CONFIRMED",
        signature: "sig-1",
        createdAt: at(-HOUR_MS),
      },
    });
    // A transfer of a deposit address (V1-33): not a withdrawal of the user.
    await prisma.withdrawal.create({
      data: {
        userId: user.id,
        fromAddress: "DEPOSIT",
        toAddress: TEST,
        lamports: 1n,
        kind: "DEPOSIT_SWEEP",
      },
    });
    const draft = await prisma.tokenDraft.create({ data: { userId: user.id } });
    await prisma.simulation.create({
      data: { userId: user.id, tokenDraftId: draft.id, devBuySol: 1, seed: 1, params: {} },
    });
    await prisma.aiGeneration.createMany({
      data: [
        { userId: user.id, kind: "TEXT", createdAt: at(-HOUR_MS) },
        { userId: user.id, kind: "TEXT", createdAt: at(-DAY_MS) },
        { userId: user.id, kind: "LOGO", createdAt: at(-HOUR_MS) },
      ],
    });

    const data = await service().loadUserSupportData(user, NOW);

    expect(data.plan).toMatchObject({ kind: "ACTIVE", subscription: { plan: "PREMIUM" } });
    expect(data.history).toEqual([
      {
        plan: "CLASSIC",
        duration: "TWO_DAYS",
        status: "EXPIRED",
        startsAt: at(-5 * DAY_MS),
        expiresAt: at(-3 * DAY_MS),
        fromPayment: false,
      },
    ]);
    expect(data.payments.map((payment) => payment.status)).toEqual(["EXPIRED", "SWEPT"]);
    expect(data.payments[0]).toMatchObject({ priceUsd: "59.00", receivedLamports: 200_000_000n });
    expect(data.paymentCount).toBe(2);
    expect(data.wallets.map((wallet) => [wallet.name, wallet.source])).toEqual([
      ["Main", "CREATED"],
      ["Test", "IMPORTED_KEY"],
    ]);
    for (const wallet of data.wallets) {
      expect(Object.keys(wallet).filter((key) => KEY_COLUMNS.includes(key))).toEqual([]);
    }
    expect(data.withdrawals).toEqual([
      expect.objectContaining({ kind: "USER", walletName: "Main", signature: "sig-1" }),
    ]);
    expect(data).toMatchObject({ drafts: 1, simulations: 1, aiToday: 1 });
  });

  it("finds the transfers of an account deleted for inactivity by its Telegram id", async () => {
    await prisma.withdrawal.create({
      data: {
        fromAddress: MAIN,
        toAddress: TEST,
        lamports: 2_499_985_000n,
        status: "CONFIRMED",
        kind: "INACTIVITY_SWEEP",
        userTelegramId: 5_550_000n,
      },
    });

    expect(await service().inactivitySweeps(5_550_000n)).toEqual([
      expect.objectContaining({
        walletName: null,
        lamports: 2_499_985_000n,
        kind: "INACTIVITY_SWEEP",
      }),
    ]);
    expect(await service().inactivitySweeps(5_550_001n)).toEqual([]);
  });

  it("gives Reveal keys the encrypted columns it decrypts", async () => {
    const user = await createTestUser(prisma);
    const vault = createKeyVault(new Uint8Array(32));
    const created = generateMnemonicWallet();
    try {
      await prisma.wallet.create({
        data: {
          userId: user.id,
          name: "Main",
          publicKey: created.address,
          source: "CREATED",
          ...vault.encrypt(created.secretKey, created.address),
          ...vault.encryptMnemonic(created.mnemonic, created.address),
        },
      });
    } finally {
      created.secretKey.dispose();
    }

    const [row] = await service().walletSecrets(user.id);

    expect(row).toMatchObject({ name: "Main", publicKey: created.address, source: "CREATED" });
    expect(revealWalletSecrets(row!, vault).mnemonic).toBe(created.mnemonic);
  });

  it("keeps the keys messages due for the sweeper, across a restart", async () => {
    const store = createSensitiveMessageStore({ prisma });
    await store.schedule(777n, 10, at(-SECOND_MS));
    await store.schedule(777n, 11, at(MINUTE_MS));

    const due = await store.listDue(NOW, 50);
    expect(due.map((row) => row.messageId)).toEqual([10]);

    await store.retryLater(due[0]!.id);
    expect(await store.listDue(NOW, 50)).toMatchObject([{ messageId: 10, attempts: 1 }]);
    await store.remove(due[0]!.id);
    expect(await store.listDue(at(2 * MINUTE_MS), 50)).toMatchObject([{ messageId: 11 }]);
  });
});
