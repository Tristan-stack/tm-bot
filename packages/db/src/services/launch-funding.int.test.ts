import { LAMPORTS_PER_SOL } from "@launchbot/shared";
import { createKeyVault, generateMnemonicWallet } from "@launchbot/solana";
import type { TxFailure, TxSuccess } from "@launchbot/solana";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  createTestUser,
  resetTestDatabase,
  testTransferQuote,
  testWalletData,
} from "../test-db.js";
import { createBalancesService } from "./balances.js";
import { createLaunchFundingService, launchWalletName } from "./launch-funding.js";
import { getWalletQuota } from "./subscriptions.js";
import { createWithdrawalService } from "./withdrawals.js";
import type { TransferApi } from "./withdrawals.js";

const FROM = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
/** The dev buy of 1 SOL and a 3 SOL bundle, fees included. */
const DEBIT = 4n * LAMPORTS_PER_SOL;
const FEE = 5_001n;

const vault = createKeyVault(new Uint8Array(32));

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("launch funding service (db)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("launch_funding"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.withdrawal.deleteMany();
    await prisma.wallet.deleteMany();
  });

  /**
   * The withdrawal service on a V1-13 answering from the script: a refusal before anything is
   * recorded, or the quote, the broadcast, then `send` (a confirmed transfer by default).
   */
  function serviceOf(options: { refuse?: TxFailure; send?: TxSuccess | TxFailure } = {}) {
    const send = vi.fn<TransferApi["send"]>(
      async (request, _signer, { onPrepared, onSubmitted } = {}) => {
        if (options.refuse !== undefined) return options.refuse;
        const result: TxSuccess | TxFailure = options.send ?? {
          ok: true,
          signature: `sig-${Date.now()}-${Math.random()}`,
          slot: 1,
          feeLamports: FEE,
          amountLamports: request.amountLamports - FEE,
        };
        await onPrepared?.(
          testTransferQuote({ ...request, amountLamports: request.amountLamports - FEE }),
        );
        if (result.ok || result.signature !== undefined) {
          await onSubmitted?.(result.signature ?? "");
        }
        return result;
      },
    );
    const balances = createBalancesService({
      prisma,
      readLamports: (addresses) =>
        Promise.resolve(new Map(addresses.map((address) => [address, 10n * LAMPORTS_PER_SOL]))),
    });
    const withdrawals = createWithdrawalService({
      prisma,
      balances,
      vault,
      withdrawFeeBudgetLamports: 6_000n,
      transfer: {
        estimateFee: () => Promise.resolve(6_000n),
        rentMin: () => Promise.resolve(890_880n),
        prepare: () => Promise.reject(new Error("not used by the funding")),
        send,
        lookup: () => Promise.resolve({ status: "not_found" }),
      },
    });
    const service = createLaunchFundingService({
      prisma,
      vault,
      generateWallet: generateMnemonicWallet,
      withdrawals,
    });
    return { service, send, balances };
  }

  /** A user with the wallet of step 1. */
  async function seed() {
    const user = await createTestUser(prisma);
    const wallet = await prisma.wallet.create({ data: testWalletData(user.id, "Main", FROM) });
    return { user, wallet };
  }

  const fundOf = (seeded: Awaited<ReturnType<typeof seed>>) => ({
    userId: seeded.user.id,
    walletId: seeded.wallet.id,
    debitLamports: DEBIT,
    symbol: "OTTR",
  });

  const launchWalletsOf = (userId: string) =>
    prisma.wallet.findMany({ where: { userId, kind: "LAUNCH" } });

  it("moves the dev buy and the bundle to a fresh launch wallet, fees taken out", async () => {
    const seeded = await seed();
    const { service, send } = serviceOf();

    const outcome = await service.fund(fundOf(seeded));

    expect(outcome.status).toBe("funded");
    const [launchWallet] = await launchWalletsOf(seeded.user.id);
    const address = launchWallet?.publicKey ?? "";
    expect(launchWallet).toMatchObject({
      source: "CREATED",
      kind: "LAUNCH",
      name: launchWalletName("OTTR", address),
    });
    // Its phrase is kept as for Create wallet, and its key opens its own address.
    expect(launchWallet?.encMnemonic).not.toBeNull();
    const signed = await vault.withSigner(
      {
        encSecretKey: launchWallet?.encSecretKey ?? new Uint8Array(),
        iv: launchWallet?.iv ?? new Uint8Array(),
        authTag: launchWallet?.authTag ?? new Uint8Array(),
      },
      address,
      (signer) => Promise.resolve(signer.publicKey.toBase58()),
    );
    expect(signed).toBe(address);

    expect(send.mock.calls[0]?.[0]).toEqual({
      from: FROM,
      to: address,
      mode: "debit",
      amountLamports: DEBIT,
    });
    expect(await prisma.withdrawal.findMany()).toEqual([
      expect.objectContaining({
        userId: seeded.user.id,
        walletId: seeded.wallet.id,
        fromAddress: FROM,
        toAddress: address,
        lamports: DEBIT - FEE,
        feeLamports: FEE,
        status: "CONFIRMED",
        kind: "LAUNCH_FUNDING",
      }),
    ]);
  });

  it("keeps the launch wallet off the user's screens and out of the limit of the plan", async () => {
    const seeded = await seed();
    const { service, balances } = serviceOf();

    await service.fund(fundOf(seeded));

    expect(await launchWalletsOf(seeded.user.id)).toHaveLength(1);
    const read = await balances.getUserBalances(seeded.user.id, { skipCache: true });
    expect(read.wallets.map((row) => row.id)).toEqual([seeded.wallet.id]);
    expect((await getWalletQuota(prisma, seeded.user.id)).count).toBe(1);
  });

  it("leaves nothing behind when the transfer is refused before anything is sent", async () => {
    const seeded = await seed();
    const short: TxFailure = {
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      landed: "no",
      missingLamports: 12_000n,
    };

    const outcome = await serviceOf({ refuse: short }).service.fund(fundOf(seeded));

    expect(outcome).toEqual({ status: "refused", failure: short });
    expect(await launchWalletsOf(seeded.user.id)).toEqual([]);
    expect(await prisma.withdrawal.count()).toBe(0);
  });

  it("erases a launch wallet nothing reached, and keeps one the SOL may still reach", async () => {
    const failed = await seed();
    const unknown = await seed();

    const failedOutcome = await serviceOf({
      send: { ok: false, code: "TRANSACTION_REJECTED", landed: "yes", signature: "sig-f" },
    }).service.fund(fundOf(failed));
    const unknownOutcome = await serviceOf({
      send: { ok: false, code: "CONFIRMATION_UNKNOWN", landed: "unknown", signature: "sig-u" },
    }).service.fund(fundOf(unknown));

    expect(failedOutcome.status).toBe("failed");
    expect(await launchWalletsOf(failed.user.id)).toEqual([]);
    expect(
      await prisma.withdrawal.findFirst({ where: { walletId: failed.wallet.id } }),
    ).toMatchObject({ status: "FAILED", kind: "LAUNCH_FUNDING" });

    expect(unknownOutcome.status).toBe("failed");
    expect(await launchWalletsOf(unknown.user.id)).toHaveLength(1);
    expect(
      await prisma.withdrawal.findFirst({ where: { walletId: unknown.wallet.id } }),
    ).toMatchObject({ status: "PENDING", signature: "sig-u" });
  });

  it("refuses while a transfer of the chosen wallet is in flight, and leaves nothing", async () => {
    const seeded = await seed();
    await prisma.withdrawal.create({
      data: {
        userId: seeded.user.id,
        walletId: seeded.wallet.id,
        fromAddress: FROM,
        toAddress: FROM,
        lamports: 1n,
      },
    });
    const { service, send } = serviceOf();

    expect(await service.fund(fundOf(seeded))).toEqual({ status: "in_progress" });
    expect(send).not.toHaveBeenCalled();
    expect(await launchWalletsOf(seeded.user.id)).toEqual([]);
  });

  it("funds from none but a wallet the user manages", async () => {
    const seeded = await seed();
    const other = await createTestUser(prisma);
    const { service } = serviceOf();
    await service.fund(fundOf(seeded));
    const [launchWallet] = await launchWalletsOf(seeded.user.id);

    for (const [userId, walletId] of [
      [other.id, seeded.wallet.id],
      [seeded.user.id, launchWallet?.id ?? ""],
    ] as const) {
      expect(await service.fund({ ...fundOf(seeded), userId, walletId })).toEqual({
        status: "not_found",
      });
    }
    // Only the launch wallet of the first funding is left.
    expect(await prisma.wallet.count({ where: { kind: "LAUNCH" } })).toBe(1);
  });
});
