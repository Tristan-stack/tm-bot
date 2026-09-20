import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "./client.js";
import { isUniqueViolation } from "./errors.js";
import { Prisma } from "./generated/prisma/client.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { resetTestDatabase } from "./test-db.js";

// Needs PostgreSQL (`pnpm db:up`). The launchbot_test database is dropped and rebuilt with
// `prisma migrate deploy`, which also proves that the migrations apply to an empty database.
describe.skipIf(!process.env["RUN_DB_TESTS"])("schema constraints (db)", () => {
  let prisma: PrismaClient;
  let nextTelegramId = 1000n;

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase());
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const createUser = () => prisma.user.create({ data: { telegramId: nextTelegramId++ } });

  const walletData = (userId: string, name: string, publicKey: string) => ({
    userId,
    name,
    publicKey,
    source: "CREATED" as const,
    encSecretKey: new Uint8Array([1, 2, 3]),
    iv: new Uint8Array([4, 5]),
    authTag: new Uint8Array([6]),
  });

  const paymentData = (userId: string, depositAddress: string) => ({
    userId,
    plan: "PREMIUM" as const,
    duration: "TWO_DAYS" as const,
    priceUsd: "59.00",
    solUsdRate: "103.36000000",
    expectedLamports: 570_820_434n,
    depositAddress,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  const subscriptionData = (userId: string, paymentId: string | null) => ({
    userId,
    paymentId,
    plan: "PREMIUM" as const,
    duration: "TWO_DAYS" as const,
    startsAt: new Date(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  });

  it("applies every migration to an empty database", async () => {
    const tables = await prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY 1`;

    expect(tables.map((table) => table.name)).toEqual([
      "AiGeneration",
      "Payment",
      // grammY sessions and conversations (V1-04)
      "Session",
      "Simulation",
      "Subscription",
      "TokenDraft",
      "User",
      "Wallet",
      "Withdrawal",
    ]);
  });

  it("creates the indexes the jobs and screens rely on", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const indexes = rows.map((row) => row.indexname);

    expect(indexes).toEqual(
      expect.arrayContaining([
        "Payment_status_expiresAt_idx",
        "Subscription_status_expiresAt_idx",
        "User_lastActiveAt_idx",
        "AiGeneration_userId_createdAt_idx",
        "Withdrawal_kind_userTelegramId_idx",
        "User_telegramId_key",
        "Wallet_userId_name_key",
        "Wallet_userId_publicKey_key",
        "Subscription_paymentId_key",
        "Payment_depositAddress_key",
      ]),
    );
  });

  it("allows one account per Telegram id", async () => {
    const user = await createUser();

    const duplicate = prisma.user.create({ data: { telegramId: user.telegramId } });

    await expect(duplicate).rejects.toSatisfy((error) => isUniqueViolation(error, ["telegramId"]));
  });

  it("keeps wallet names and addresses unique per user only", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    await prisma.wallet.create({ data: walletData(alice.id, "Main", "ADDRESS_1") });

    await expect(
      prisma.wallet.create({ data: walletData(alice.id, "Main", "ADDRESS_2") }),
    ).rejects.toSatisfy((error) => isUniqueViolation(error, ["userId", "name"]));
    await expect(
      prisma.wallet.create({ data: walletData(alice.id, "Other", "ADDRESS_1") }),
    ).rejects.toSatisfy((error) => isUniqueViolation(error, ["userId", "publicKey"]));
    // Another user may reuse the name, and import the same key.
    await expect(
      prisma.wallet.create({ data: walletData(bob.id, "Main", "ADDRESS_1") }),
    ).resolves.toMatchObject({ name: "Main" });
  });

  it("stores the encrypted seed phrase with its iv and auth tag, or not at all", async () => {
    const user = await createUser();
    const mnemonic = {
      encMnemonic: new Uint8Array([7]),
      mnemonicIv: new Uint8Array([8]),
      mnemonicAuthTag: new Uint8Array([9]),
    };

    await expect(
      prisma.wallet.create({
        data: { ...walletData(user.id, "Seeded", "ADDRESS_S"), ...mnemonic },
      }),
    ).resolves.toMatchObject({ source: "CREATED" });
    await expect(
      prisma.wallet.create({
        data: { ...walletData(user.id, "Partial", "ADDRESS_P"), encMnemonic: mnemonic.encMnemonic },
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it("activates a subscription only once per invoice under concurrency", async () => {
    const user = await createUser();
    const payment = await prisma.payment.create({ data: paymentData(user.id, "DEPOSIT_RACE") });

    const results = await Promise.allSettled([
      prisma.subscription.create({ data: subscriptionData(user.id, payment.id) }),
      prisma.subscription.create({ data: subscriptionData(user.id, payment.id) }),
    ]);

    const rejected = results.filter((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(isUniqueViolation(rejected[0]?.reason, ["paymentId"])).toBe(true);
    // A manual /grant has no invoice: several rows without paymentId are fine.
    await prisma.subscription.create({ data: subscriptionData(user.id, null) });
    await prisma.subscription.create({ data: subscriptionData(user.id, null) });
  });

  it("gives every invoice its own deposit address", async () => {
    const user = await createUser();
    await prisma.payment.create({ data: paymentData(user.id, "DEPOSIT_UNIQUE") });

    await expect(
      prisma.payment.create({ data: paymentData(user.id, "DEPOSIT_UNIQUE") }),
    ).rejects.toSatisfy((error) => isUniqueViolation(error, ["depositAddress"]));
  });

  it("purges a user but keeps payments and withdrawals, detached from the account", async () => {
    const user = await createUser();
    const wallet = await prisma.wallet.create({ data: walletData(user.id, "Main", "ADDRESS_X") });
    const payment = await prisma.payment.create({ data: paymentData(user.id, "DEPOSIT_PURGE") });
    await prisma.subscription.create({ data: subscriptionData(user.id, payment.id) });
    await prisma.aiGeneration.create({ data: { userId: user.id, kind: "TEXT" } });
    const draft = await prisma.tokenDraft.create({ data: { userId: user.id, name: "Moon Otter" } });
    await prisma.simulation.create({
      data: { userId: user.id, tokenDraftId: draft.id, devBuySol: "5", seed: 42, params: {} },
    });
    const withdrawal = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        fromAddress: "ADDRESS_X",
        toAddress: "TREASURY",
        lamports: 2_500_000_000n,
        kind: "INACTIVITY_SWEEP",
        userTelegramId: user.telegramId,
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const where = { where: { userId: user.id } };
    expect(await prisma.wallet.count(where)).toBe(0);
    expect(await prisma.subscription.count(where)).toBe(0);
    expect(await prisma.aiGeneration.count(where)).toBe(0);
    expect(await prisma.tokenDraft.count(where)).toBe(0);
    expect(await prisma.simulation.count(where)).toBe(0);
    expect(await prisma.payment.findUnique({ where: { id: payment.id } })).toMatchObject({
      userId: null,
      depositAddress: "DEPOSIT_PURGE",
    });
    expect(await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } })).toMatchObject({
      userId: null,
      walletId: null,
      fromAddress: "ADDRESS_X",
      userTelegramId: user.telegramId,
    });
  });

  it("keeps the withdrawals of a deleted wallet", async () => {
    const user = await createUser();
    const wallet = await prisma.wallet.create({ data: walletData(user.id, "Main", "ADDRESS_W") });
    const withdrawal = await prisma.withdrawal.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        fromAddress: "ADDRESS_W",
        toAddress: "DESTINATION",
        lamports: 1n,
      },
    });

    await prisma.wallet.delete({ where: { id: wallet.id } });

    expect(await prisma.withdrawal.findUnique({ where: { id: withdrawal.id } })).toMatchObject({
      userId: user.id,
      walletId: null,
      fromAddress: "ADDRESS_W",
      kind: "USER",
    });
  });

  it("round-trips lamports, USD amounts, encrypted bytes and JSON without loss", async () => {
    const user = await createUser();
    const twentySol = 20_000_000_000n;
    const params = {
      seed: 42,
      devBuySol: 5,
      curve: { virtualSol: 30, feeRate: 0.01 },
      solUsdPrice: null,
    };
    const secret = new Uint8Array([0, 255, 16, 32, 0]);

    const payment = await prisma.payment.create({
      data: {
        ...paymentData(user.id, "DEPOSIT_TYPES"),
        expectedLamports: twentySol,
        encSecretKey: secret,
      },
    });
    const draft = await prisma.tokenDraft.create({ data: { userId: user.id } });
    const simulation = await prisma.simulation.create({
      data: {
        userId: user.id,
        tokenDraftId: draft.id,
        devBuySol: "5.000000001",
        seed: 2_147_483_647,
        params,
      },
    });

    const storedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(storedPayment.expectedLamports).toBe(twentySol);
    expect(storedPayment.receivedLamports).toBe(0n);
    expect(storedPayment.priceUsd.toFixed(2)).toBe("59.00");
    expect(storedPayment.solUsdRate.toString()).toBe("103.36");
    expect(storedPayment.encSecretKey).toEqual(secret);
    expect(storedPayment.iv).toBeNull();

    const storedSimulation = await prisma.simulation.findUniqueOrThrow({
      where: { id: simulation.id },
    });
    expect(storedSimulation.devBuySol.toString()).toBe("5.000000001");
    expect(storedSimulation.seed).toBe(2_147_483_647);
    expect(storedSimulation.params).toEqual(params);
  });
});
