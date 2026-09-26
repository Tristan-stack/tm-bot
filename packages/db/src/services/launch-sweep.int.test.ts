import { HOUR_MS, LAMPORTS_PER_SOL, MINUTE_MS, SECOND_MS } from "@launchbot/shared";
import { createKeyVault } from "@launchbot/solana";
import type { SignatureOutcome, TxFailure, TxSuccess } from "@launchbot/solana";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../client.js";
import type { Prisma, PrismaClient, User } from "../generated/prisma/client.js";
import {
  createTestUser,
  fakeChain,
  resetTestDatabase,
  testTransferQuote,
  testWalletData,
} from "../test-db.js";
import { launchWalletName } from "./launch-funding.js";
import { createLaunchSweepService } from "./launch-sweep.js";
import type { TransferApi } from "./withdrawals.js";

const TREASURY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MAIN = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const LAUNCHES = [
  "8oHs3PqQ9WmYtZbLpD2rVxJk4NcAeFgH7sTuMwXyBz1K",
  "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81",
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  "Ho9sKzLw3RqTn5VbXcYd8FgJ2mPaE6uW4iNtQy7Zr1Ab",
  "Cq2Wm8XvLp4TzRn6YbKd3FhJs9GuA5eN7oPiQt1Ww3Mx",
] as const;
const FEE = 5_000n;
const FEE_BUDGET = 20_000n;
/** The dev buy and a 3 SOL bundle at `LAUNCH_TEST_DIVISOR=100`, the funding fees taken out. */
const FUNDED = 40_000_000n - FEE;
/** What Main keeps: nothing leaves it in a sweep. */
const MAIN_LAMPORTS = 10n * LAMPORTS_PER_SOL;
const START = new Date("2026-09-26T12:00:00Z");
const ago = (ms: number) => new Date(START.getTime() - ms);

type Outcome = "ok" | "failed" | "unknown";

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("launch wallets sweep (db)", () => {
  let prisma: PrismaClient;
  const { lamports: chain, read } = fakeChain();
  let clock = START;
  let failRead = false;
  const lookups = new Map<string, SignatureOutcome>();

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("launch_sweep"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    chain.clear();
    lookups.clear();
    clock = START;
    failRead = false;
    await prisma.withdrawal.deleteMany();
    await prisma.user.deleteMany();
  });

  /**
   * V1-13 on the fake chain: `max` moves the balance minus the fees. `failed` sends nothing;
   * `unknown` lands but the send cannot say so.
   */
  function serviceOf(outcomes: Outcome[] = []) {
    const queue = [...outcomes];
    const send = vi.fn<TransferApi["send"]>(async (request, _signer, callbacks = {}) => {
      const balance = chain.get(request.from) ?? 0n;
      const outcome = queue.shift() ?? "ok";
      const amount = balance - FEE;
      await callbacks.onPrepared?.(
        testTransferQuote({
          from: request.from,
          to: request.to,
          mode: "max",
          amountLamports: amount,
          balanceLamports: balance,
          fee: { ...testTransferQuote().fee, totalFeeLamports: FEE },
        }),
      );
      if (outcome === "failed") {
        return { ok: false, code: "TRANSACTION_REJECTED", landed: "no" } satisfies TxFailure;
      }
      chain.set(request.from, 0n);
      chain.set(request.to, (chain.get(request.to) ?? 0n) + amount);
      const signature = `sweep-${request.from}`;
      await callbacks.onSubmitted?.(signature);
      if (outcome === "unknown") {
        return {
          ok: false,
          code: "CONFIRMATION_UNKNOWN",
          landed: "unknown",
          signature,
        } satisfies TxFailure;
      }
      return {
        ok: true,
        signature,
        slot: 1,
        feeLamports: FEE,
        amountLamports: amount,
      } satisfies TxSuccess;
    });
    const lookup = vi.fn<TransferApi["lookup"]>((signature) =>
      Promise.resolve(lookups.get(signature) ?? { status: "not_found" }),
    );
    const service = createLaunchSweepService({
      prisma,
      transfer: { send, lookup },
      vault: createKeyVault(new Uint8Array(32)),
      readLamports: (addresses) =>
        failRead ? Promise.reject(new Error("RPC down")) : read(addresses),
      treasury: TREASURY,
      feeBudgetLamports: FEE_BUDGET,
      now: () => clock,
    });
    return { service, send };
  }

  /** A user with the wallet of step 1, 10 SOL on it. */
  async function seed() {
    const user = await createTestUser(prisma);
    chain.set(MAIN, MAIN_LAMPORTS);
    const main = await prisma.wallet.create({
      data: { ...testWalletData(user.id, "Main", MAIN), createdAt: ago(HOUR_MS * 24) },
    });
    return { user, main };
  }

  /** A launch wallet created `createdAgo` ago, holding `lamports`. */
  async function launchWallet(user: User, address: string, createdAgo: number, lamports = 0n) {
    chain.set(address, lamports);
    return prisma.wallet.create({
      data: {
        ...testWalletData(user.id, launchWalletName("OTTR", address), address),
        kind: "LAUNCH",
        createdAt: ago(createdAgo),
      },
    });
  }

  /** The funding of `address` from Main, sent `sentAgo` ago. */
  const funding = (
    seeded: Awaited<ReturnType<typeof seed>>,
    address: string,
    sentAgo: number,
    row: Partial<Prisma.WithdrawalUncheckedCreateInput> = {},
  ) =>
    prisma.withdrawal.create({
      data: {
        userId: seeded.user.id,
        walletId: seeded.main.id,
        fromAddress: MAIN,
        toAddress: address,
        lamports: FUNDED,
        feeLamports: FEE,
        status: "CONFIRMED",
        signature: `funding-${address}`,
        kind: "LAUNCH_FUNDING",
        createdAt: ago(sentAgo),
        ...row,
      },
    });

  const launchSweeps = () =>
    prisma.withdrawal.findMany({ where: { kind: "LAUNCH_SWEEP" }, orderBy: { createdAt: "asc" } });

  it("lists the launch wallets the bot left after 15 minutes, and those never funded after an hour", async () => {
    const seeded = await seed();
    const [funded, young, slow, unfunded, abandoned] = LAUNCHES;
    // Its chart stopped by a restart: the bot never swept it.
    const due = await launchWallet(seeded.user, funded, 17 * MINUTE_MS);
    await funding(seeded, funded, 16 * MINUTE_MS);
    // Its chart may still run.
    await launchWallet(seeded.user, young, 5 * MINUTE_MS);
    await funding(seeded, young, 5 * MINUTE_MS - 10 * SECOND_MS);
    // Created 20 minutes ago, its funding only went out 10 minutes ago.
    await launchWallet(seeded.user, slow, 20 * MINUTE_MS);
    await funding(seeded, slow, 10 * MINUTE_MS);
    await launchWallet(seeded.user, unfunded, 30 * MINUTE_MS);
    const lost = await launchWallet(seeded.user, abandoned, 2 * HOUR_MS);

    expect(await serviceOf().service.listDue(START)).toEqual([lost.id, due.id]);
  });

  it("moves what the launch wallet holds to the treasury, then erases it with its key", async () => {
    const seeded = await seed();
    const [address] = LAUNCHES;
    const wallet = await launchWallet(seeded.user, address, 2 * MINUTE_MS, FUNDED);
    await funding(seeded, address, 90 * SECOND_MS);
    const { service, send } = serviceOf();

    expect(await service.sweepLaunchWallet(wallet.id)).toMatchObject({
      status: "ERASED",
      transfers: [{ fromAddress: address, lamports: FUNDED - FEE }],
    });
    expect(send).toHaveBeenCalledOnce();
    expect(chain.get(TREASURY)).toBe(FUNDED - FEE);
    expect(chain.get(MAIN)).toBe(MAIN_LAMPORTS);
    expect(await launchSweeps()).toEqual([
      expect.objectContaining({
        userId: seeded.user.id,
        walletId: null,
        fromAddress: address,
        toAddress: TREASURY,
        lamports: FUNDED - FEE,
        feeLamports: FEE,
        status: "CONFIRMED",
        userTelegramId: seeded.user.telegramId,
      }),
    ]);
    expect(await prisma.wallet.count({ where: { kind: "LAUNCH" } })).toBe(0);
    // Main and the books stay.
    expect(await prisma.wallet.count({ where: { id: seeded.main.id } })).toBe(1);
    expect(await prisma.withdrawal.findFirst({ where: { kind: "LAUNCH_FUNDING" } })).toMatchObject({
      toAddress: address,
      status: "CONFIRMED",
    });
  });

  it("keeps the launch wallet while its funding may still land, then sweeps it", async () => {
    const seeded = await seed();
    const [address] = LAUNCHES;
    const wallet = await launchWallet(seeded.user, address, 2 * MINUTE_MS);
    const pending = await funding(seeded, address, 90 * SECOND_MS, { status: "PENDING" });
    const first = serviceOf();

    expect(await first.service.sweepLaunchWallet(wallet.id)).toMatchObject({
      status: "KEPT",
      reason: "TX_PENDING",
    });
    expect(first.send).not.toHaveBeenCalled();
    expect(await prisma.wallet.count({ where: { id: wallet.id } })).toBe(1);

    // The next pass: the funding landed.
    clock = new Date(START.getTime() + MINUTE_MS);
    chain.set(address, FUNDED);
    lookups.set(pending.signature ?? "", { status: "confirmed", slot: 7 });
    const second = serviceOf();

    expect(await second.service.sweepLaunchWallet(wallet.id)).toMatchObject({ status: "ERASED" });
    expect(chain.get(TREASURY)).toBe(FUNDED - FEE);
    expect(await prisma.withdrawal.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      status: "CONFIRMED",
    });
  });

  it("erases a launch wallet its funding never reached, with no transfer", async () => {
    const seeded = await seed();
    const [address] = LAUNCHES;
    const wallet = await launchWallet(seeded.user, address, 6 * MINUTE_MS);
    // Past the in-flight window, and the chain does not know it: it never will.
    const lost = await funding(seeded, address, 5 * MINUTE_MS, { status: "PENDING" });
    const { service, send } = serviceOf();

    expect(await service.sweepLaunchWallet(wallet.id)).toEqual({
      status: "ERASED",
      transfers: [],
    });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.withdrawal.findUniqueOrThrow({ where: { id: lost.id } })).toMatchObject({
      status: "FAILED",
    });
    expect(await prisma.wallet.count({ where: { id: wallet.id } })).toBe(0);
  });

  it("keeps the launch wallet and its key when a read or the transfer fails", async () => {
    const seeded = await seed();
    const [address] = LAUNCHES;
    const wallet = await launchWallet(seeded.user, address, 2 * MINUTE_MS, FUNDED);
    await funding(seeded, address, 90 * SECOND_MS);

    failRead = true;
    expect(await serviceOf().service.sweepLaunchWallet(wallet.id)).toMatchObject({
      status: "KEPT",
      reason: "READ_FAILED",
    });
    failRead = false;
    expect(await serviceOf(["failed"]).service.sweepLaunchWallet(wallet.id)).toMatchObject({
      status: "KEPT",
      reason: "TX_FAILED",
    });

    expect(chain.get(address)).toBe(FUNDED);
    expect(await prisma.wallet.count({ where: { id: wallet.id } })).toBe(1);
    expect(await launchSweeps()).toMatchObject([{ status: "FAILED", walletId: wallet.id }]);
  });

  it("an unknown outcome keeps the launch wallet, then is confirmed, never sent twice", async () => {
    const seeded = await seed();
    const [address] = LAUNCHES;
    const wallet = await launchWallet(seeded.user, address, 2 * MINUTE_MS, FUNDED);
    await funding(seeded, address, 90 * SECOND_MS);
    const first = serviceOf(["unknown"]);

    expect(await first.service.sweepLaunchWallet(wallet.id)).toMatchObject({
      status: "KEPT",
      reason: "TX_PENDING",
    });
    const [pending] = await launchSweeps();
    expect(pending).toMatchObject({ status: "PENDING" });

    clock = new Date(START.getTime() + MINUTE_MS);
    lookups.set(pending?.signature ?? "", { status: "confirmed", slot: 9 });
    const second = serviceOf();

    expect(await second.service.sweepLaunchWallet(wallet.id)).toEqual({
      status: "ERASED",
      transfers: [],
    });
    expect(second.send).not.toHaveBeenCalled();
    expect(await launchSweeps()).toMatchObject([{ status: "CONFIRMED" }]);
    expect(chain.get(TREASURY)).toBe(FUNDED - FEE);
  });

  it("sweeps none but a launch wallet", async () => {
    const seeded = await seed();
    const { service, send } = serviceOf();

    expect(await service.sweepLaunchWallet(seeded.main.id)).toEqual({ status: "NOT_FOUND" });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.wallet.count({ where: { id: seeded.main.id } })).toBe(1);
  });
});
