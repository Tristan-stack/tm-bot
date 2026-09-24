import { getOffer } from "@launchbot/shared";
import { createKeyVault, generateKeypair } from "@launchbot/solana";
import type { TxSuccess } from "@launchbot/solana";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, fakeChain, resetTestDatabase, testWalletData } from "../test-db.js";
import { createBalancesService } from "./balances.js";
import { createPaymentService } from "./payments.js";
import { createSubscriptionService } from "./subscriptions.js";
import { createWalletPaymentService } from "./wallet-payments.js";
import type { TransferApi } from "./withdrawals.js";

const NOW = new Date();
const FROM = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const FEE = 15_000n;

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("payment from a bot wallet (db)", () => {
  let prisma: PrismaClient;
  const { lamports: chain, read } = fakeChain();

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("wallet_payments"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Payments, balances and a V1-13 whose send waits for `release` before it lands. */
  function services() {
    let release = () => {};
    const landed = new Promise<void>((resolve) => (release = resolve));
    const payments = createPaymentService({
      prisma,
      subscriptions: createSubscriptionService({ prisma }),
      getSolUsdPrice: () => Promise.resolve(103.36),
      readLamports: read,
      generateKeypair,
      vault: createKeyVault(new Uint8Array(32)),
    });
    const send = vi.fn<TransferApi["send"]>(async (request) => {
      await landed;
      chain.set(request.from, (chain.get(request.from) ?? 0n) - request.amountLamports - FEE);
      chain.set(request.to, (chain.get(request.to) ?? 0n) + request.amountLamports);
      const result: TxSuccess = { ok: true, signature: "sig", slot: 1, feeLamports: FEE };
      return result;
    });
    const walletPayments = createWalletPaymentService({
      prisma,
      payments,
      balances: createBalancesService({ prisma, readLamports: (a) => read(a) }),
      transfer: {
        estimateFee: () => Promise.resolve(FEE),
        rentMin: () => Promise.resolve(890_880n),
        prepare: vi.fn(),
        send,
        lookup: () => Promise.resolve({ status: "not_found" }),
      },
      vault: createKeyVault(new Uint8Array(32)),
    });
    return { payments, walletPayments, send, release };
  }

  it("two Confirms of one invoice at once: one send, the other refused, then the plan", async () => {
    const user = await createTestUser(prisma);
    const wallet = await prisma.wallet.create({ data: testWalletData(user.id, "Main", FROM) });
    chain.set(FROM, 2_000_000_000n);
    const { payments, walletPayments, send, release } = services();
    const created = await payments.createInvoice({
      userId: user.id,
      offer: getOffer("PREMIUM", "TWO_DAYS"),
      now: NOW,
    });
    if (!created.ok) throw new Error(created.error);
    const request = {
      paymentId: created.invoice.id,
      walletId: wallet.id,
      amountLamports: created.invoice.remainingLamports,
    };

    const first = walletPayments.pay(user.id, request);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const second = await walletPayments.pay(user.id, request);
    release();

    expect(second).toEqual({ status: "locked" });
    expect(await first).toMatchObject({
      status: "sent",
      check: { kind: "ACTIVATED", activatedNow: true, plan: "PREMIUM" },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(chain.get(created.invoice.depositAddress)).toBe(created.invoice.expectedLamports);

    // The lock is gone with its transaction; the invoice is paid, so nothing is sent again.
    expect(await walletPayments.pay(user.id, request)).toMatchObject({
      status: "blocked",
      check: { kind: "ACTIVATED" },
    });
    expect(send).toHaveBeenCalledTimes(1);
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { userId: user.id } });
    expect(subscription).toMatchObject({ plan: "PREMIUM", status: "ACTIVE" });
  });
});
