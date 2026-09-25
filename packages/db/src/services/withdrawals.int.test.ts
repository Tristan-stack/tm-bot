import { WITHDRAWAL_IN_FLIGHT_MS } from "@launchbot/shared";
import type { KeyVault, TxFailure, TxSuccess } from "@launchbot/solana";
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
import { createWithdrawalService } from "./withdrawals.js";
import type { TransferApi } from "./withdrawals.js";

const FROM = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TO = "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81";
const BALANCE = 2_500_000_000n;
const FEE = 5_001n;
const AMOUNT = { kind: "exact", lamports: 1_000_000n } as const;

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("withdrawal service (db)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("withdrawals"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.withdrawal.deleteMany();
    await prisma.wallet.deleteMany();
  });

  /** A V1-13 answering from the script: quote, broadcast, then `send`, or a confirmed send. */
  function serviceOf(options: { send?: TxSuccess | TxFailure; now?: () => number } = {}) {
    const send = vi.fn<TransferApi["send"]>(
      async (_request, _signer, { onPrepared, onSubmitted } = {}) => {
        const result: TxSuccess | TxFailure = options.send ?? {
          ok: true,
          signature: `sig-${Date.now()}-${Math.random()}`,
          slot: 1,
          feeLamports: FEE,
          amountLamports: AMOUNT.lamports,
        };
        await onPrepared?.(
          testTransferQuote({ from: FROM, to: TO, amountLamports: AMOUNT.lamports }),
        );
        if (result.ok || result.signature !== undefined)
          await onSubmitted?.(result.signature ?? "");
        return result;
      },
    );
    const service = createWithdrawalService({
      prisma,
      balances: createBalancesService({
        prisma,
        readLamports: (addresses) => Promise.resolve(new Map(addresses.map((a) => [a, BALANCE]))),
      }),
      vault: {} as KeyVault,
      withdrawFeeBudgetLamports: 6_000n,
      now: options.now,
      transfer: {
        estimateFee: () => Promise.resolve(6_000n),
        rentMin: () => Promise.resolve(890_880n),
        prepare: () => Promise.resolve(testTransferQuote({ from: FROM, to: TO })),
        send,
        lookup: () => Promise.resolve({ status: "not_found" }),
      },
    });
    return { service, send };
  }

  /** A user with one wallet holding `BALANCE`. */
  async function seed() {
    const user = await createTestUser(prisma);
    const wallet = await prisma.wallet.create({ data: testWalletData(user.id, "Main", FROM) });
    return { user, wallet };
  }

  it("writes the row of a confirmed withdrawal as §13 describes it", async () => {
    const { user, wallet } = await seed();

    const outcome = await serviceOf().service.execute(user.id, wallet.id, TO, AMOUNT);

    expect(outcome.status).toBe("sent");
    const rows = await prisma.withdrawal.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      walletId: wallet.id,
      fromAddress: FROM,
      toAddress: TO,
      lamports: AMOUNT.lamports,
      feeLamports: FEE,
      status: "CONFIRMED",
      error: null,
      kind: "USER",
    });
    expect(rows[0]?.signature).toMatch(/^sig-/);
  });

  it("keeps a FAILED row with its error, and an unknown one PENDING with its signature", async () => {
    const failed = await seed();
    const unknown = await seed();

    await serviceOf({
      send: { ok: false, code: "INSUFFICIENT_FUNDS", landed: "no", detail: "AccountNotFound" },
    }).service.execute(failed.user.id, failed.wallet.id, TO, AMOUNT);
    await serviceOf({
      send: { ok: false, code: "CONFIRMATION_UNKNOWN", landed: "unknown", signature: "sig-u" },
    }).service.execute(unknown.user.id, unknown.wallet.id, TO, AMOUNT);

    expect(
      await prisma.withdrawal.findFirst({ where: { walletId: failed.wallet.id } }),
    ).toMatchObject({ status: "FAILED", error: "INSUFFICIENT_FUNDS: AccountNotFound" });
    expect(
      await prisma.withdrawal.findFirst({ where: { walletId: unknown.wallet.id } }),
    ).toMatchObject({ status: "PENDING", signature: "sig-u", error: null });
  });

  it("refuses a second withdrawal while the first is PENDING, then settles it once stale", async () => {
    const { user, wallet } = await seed();
    const unknown = serviceOf({
      send: { ok: false, code: "CONFIRMATION_UNKNOWN", landed: "unknown", signature: "sig-u2" },
    }).service;
    await unknown.execute(user.id, wallet.id, TO, AMOUNT);

    expect((await unknown.execute(user.id, wallet.id, TO, AMOUNT)).status).toBe("in_progress");

    const later = serviceOf({ now: () => Date.now() + WITHDRAWAL_IN_FLIGHT_MS }).service;
    const outcome = await later.execute(user.id, wallet.id, TO, AMOUNT);

    expect(outcome.status).toBe("sent");
    const rows = await prisma.withdrawal.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.status, row.error])).toEqual([
      ["FAILED", "BLOCKHASH_EXPIRED"],
      ["CONFIRMED", null],
    ]);
  });

  it("keeps the rows of a deleted wallet, without the wallet", async () => {
    const { user, wallet } = await seed();
    await serviceOf().service.execute(user.id, wallet.id, TO, AMOUNT);

    await prisma.wallet.delete({ where: { id: wallet.id } });

    expect(await prisma.withdrawal.findFirst({ where: { userId: user.id } })).toMatchObject({
      walletId: null,
      status: "CONFIRMED",
    });
  });
});
