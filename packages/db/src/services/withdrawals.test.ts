import { WITHDRAWAL_IN_FLIGHT_MS } from "@launchbot/shared";
import type { KeyVault, TxFailure, TxSuccess } from "@launchbot/solana";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, Withdrawal } from "../generated/prisma/client.js";
import { testTransferQuote } from "../test-db.js";
import type { WalletBalance } from "./balances.js";
import { createWithdrawalService, resolveWithdrawAmount } from "./withdrawals.js";
import type { TransferApi } from "./withdrawals.js";

const T0 = new Date("2026-09-23T12:00:00Z");
const USER = "u1";
const FROM = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TO = "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81";
const RENT_MIN = 890_880n;
/** 540 units at 1 000 µL: 5 000 + 1 lamport. */
const FEE = 5_001n;
const BALANCE = 2_500_000_000n;
const SIGNATURE =
  "5KtPabcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnx9Qm";

const wallet: WalletBalance = {
  id: "w1",
  name: "Main",
  publicKey: FROM,
  createdAt: T0,
  lamports: BALANCE,
};

const quoteOf = (amount: bigint | "max") =>
  testTransferQuote({
    mode: amount === "max" ? "max" : "exact",
    amountLamports: amount === "max" ? BALANCE - FEE : amount,
  });

const success = (amount: bigint): TxSuccess => ({
  ok: true,
  signature: SIGNATURE,
  slot: 4_242,
  feeLamports: FEE,
  amountLamports: amount,
});

const MAX = { kind: "max" } as const;
const EXACT = { kind: "exact", lamports: 1_000_000n } as const;

/** A vault that never has to decrypt here: the fake `send` signs nothing. */
const vault = {} as KeyVault;

const rowOf = (overrides: Partial<Withdrawal>): Withdrawal => ({
  id: "wd0",
  userId: USER,
  walletId: "w1",
  fromAddress: FROM,
  toAddress: TO,
  lamports: 1_000n,
  feeLamports: FEE,
  signature: null,
  status: "PENDING",
  error: null,
  kind: "USER",
  userTelegramId: null,
  createdAt: T0,
  ...overrides,
});

/**
 * The withdrawal table in memory, a wallet row with placeholder key columns, and a V1-13 that
 * answers from a script: `send` quotes (`onPrepared`), broadcasts (`onSubmitted`), then answers.
 */
function harness(
  options: {
    lamports?: bigint | null;
    status?: "fresh" | "stale" | "unavailable";
    rows?: Partial<Withdrawal>[];
    prepare?: TxFailure;
    send?: TxSuccess | TxFailure;
    lookup?: Awaited<ReturnType<TransferApi["lookup"]>>;
    now?: number;
  } = {},
) {
  const { lamports = BALANCE, status = "fresh", send = success(BALANCE - FEE) } = options;
  let nextId = 1;
  const rows: Withdrawal[] = (options.rows ?? []).map((row) =>
    rowOf({ id: `wd${nextId++}`, ...row }),
  );

  const prisma = {
    wallet: {
      findFirst: vi.fn(({ where }: { where: { id: string; userId: string } }) =>
        Promise.resolve(
          where.id === "w1" && where.userId === USER
            ? {
                id: "w1",
                name: "Main",
                publicKey: FROM,
                createdAt: T0,
                encSecretKey: new Uint8Array([1]),
                iv: new Uint8Array([2]),
                authTag: new Uint8Array([3]),
              }
            : null,
        ),
      ),
    },
    withdrawal: {
      findFirst: vi.fn(
        ({
          where,
        }: {
          where: { walletId?: string; id?: string; status?: string; userId?: string };
        }) =>
          Promise.resolve(
            [...rows]
              .reverse()
              .find(
                (row) =>
                  (where.id === undefined || row.id === where.id) &&
                  (where.userId === undefined || row.userId === where.userId) &&
                  (where.walletId === undefined || row.walletId === where.walletId) &&
                  (where.status === undefined || row.status === where.status),
              ) ?? null,
          ),
      ),
      create: vi.fn(({ data }: { data: Partial<Withdrawal> }) => {
        const row = rowOf({
          id: `wd${nextId++}`,
          createdAt: new Date(options.now ?? T0.getTime()),
          ...data,
        });
        rows.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<Withdrawal> }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (row === undefined) return Promise.reject(new Error("no row"));
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      }),
    },
  };

  const balances = {
    getUserBalances: vi.fn(() =>
      Promise.resolve({
        wallets: [{ ...wallet, lamports: status === "unavailable" ? null : lamports }],
        totalLamports: lamports,
        fetchedAt: T0,
        status,
      }),
    ),
    invalidateUserBalances: vi.fn(),
  };

  const signers: unknown[] = [];
  const transfer: { [K in keyof TransferApi]: ReturnType<typeof vi.fn<TransferApi[K]>> } = {
    estimateFee: vi.fn(() => Promise.resolve(6_000n)),
    rentMin: vi.fn(() => Promise.resolve(RENT_MIN)),
    prepare: vi.fn((params) =>
      Promise.resolve(options.prepare ?? quoteOf(params.amount === "max" ? "max" : params.amount)),
    ),
    send: vi.fn(async (request, signer, { onPrepared, onSubmitted }) => {
      signers.push(signer);
      // What V1-13 does: quote, hand it over, broadcast, then the scripted outcome.
      if (options.prepare !== undefined) return options.prepare;
      await onPrepared(quoteOf(request.mode === "max" ? "max" : request.amountLamports));
      await onSubmitted(send.signature ?? SIGNATURE);
      return send;
    }),
    lookup: vi.fn(() => Promise.resolve(options.lookup ?? { status: "not_found" })),
  };

  const service = createWithdrawalService({
    prisma: prisma as unknown as PrismaClient,
    balances,
    transfer,
    vault,
    withdrawFeeBudgetLamports: 6_000n,
    now: () => options.now ?? T0.getTime(),
  });
  return { service, prisma, balances, transfer, rows, signers };
}

describe("resolveWithdrawAmount", () => {
  it("floors a share of the balance to the lamport, and passes the rest through", () => {
    expect(resolveWithdrawAmount(1_000_000_001n, { kind: "pct", pct: 25 })).toBe(250_000_000n);
    expect(resolveWithdrawAmount(1_000_000_001n, { kind: "pct", pct: 50 })).toBe(500_000_000n);
    expect(resolveWithdrawAmount(BALANCE, MAX)).toBe("max");
    expect(resolveWithdrawAmount(BALANCE, EXACT)).toBe(1_000_000n);
  });
});

describe("check", () => {
  it("reads the balance without the cache and prices a transfer, with Max and the rent", async () => {
    const { service, balances } = harness();

    expect(await service.check(USER, "w1")).toEqual({
      status: "ok",
      detail: { wallet, fetchedAt: T0, status: "fresh" },
      lamports: BALANCE,
      feeLamports: 6_000n,
      maxLamports: BALANCE - 6_000n,
      rentMinLamports: RENT_MIN,
    });
    expect(balances.getUserBalances).toHaveBeenCalledExactlyOnceWith(USER, { skipCache: true });
  });

  it("finds nothing to withdraw under the fee budget, and refuses an unread balance", async () => {
    expect((await harness({ lamports: 6_000n }).service.check(USER, "w1")).status).toBe(
      "nothing_to_withdraw",
    );
    expect((await harness({ status: "stale" }).service.check(USER, "w1")).status).toBe(
      "balance_unavailable",
    );
    expect((await harness({ status: "unavailable" }).service.check(USER, "w1")).status).toBe(
      "balance_unavailable",
    );
    expect(await harness().service.check(USER, "other")).toEqual({ status: "not_found" });
  });
});

describe("quote", () => {
  it("hands the resolved amount to V1-13 and returns its quote with the check", async () => {
    const { service, transfer } = harness();

    const result = await service.quote(USER, "w1", TO, MAX);
    await service.quote(USER, "w1", TO, { kind: "pct", pct: 50 });

    expect(result).toMatchObject({ status: "ok", quote: { mode: "max" }, check: { status: "ok" } });
    expect(transfer.prepare.mock.calls.map(([params]) => params)).toEqual([
      { from: FROM, to: TO, amount: "max" },
      { from: FROM, to: TO, amount: BALANCE / 2n },
    ]);
  });

  it("returns the rule the amount breaks, with the check for the screen", async () => {
    const failure: TxFailure = {
      ok: false,
      code: "DESTINATION_BELOW_RENT",
      landed: "no",
      rentMinLamports: RENT_MIN,
    };
    const { service } = harness({ prepare: failure });

    expect(await service.quote(USER, "w1", TO, EXACT)).toMatchObject({
      status: "refused",
      failure,
      check: { lamports: BALANCE },
    });
  });

  it("passes a wallet that cannot be used through as it is", async () => {
    expect((await harness({ lamports: 1n }).service.quote(USER, "w1", TO, MAX)).status).toBe(
      "nothing_to_withdraw",
    );
  });
});

describe("execute", () => {
  it("records the quote PENDING before the broadcast, sends with the key, then CONFIRMED", async () => {
    const { service, rows, prisma, signers, balances } = harness({ send: success(BALANCE - FEE) });

    const outcome = await service.execute(USER, "w1", TO, MAX);

    expect(outcome).toMatchObject({ status: "sent", withdrawal: { signature: SIGNATURE } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: USER,
      walletId: "w1",
      fromAddress: FROM,
      toAddress: TO,
      lamports: BALANCE - FEE,
      feeLamports: FEE,
      signature: SIGNATURE,
      status: "CONFIRMED",
      kind: "USER",
    });
    // The row first, the signature next, the outcome last.
    expect(prisma.withdrawal.update.mock.calls.map(([args]) => args.data)).toEqual([
      { signature: SIGNATURE },
      { status: "CONFIRMED", signature: SIGNATURE, feeLamports: FEE, lamports: BALANCE - FEE },
    ]);
    expect(signers).toEqual([
      {
        kind: "vault",
        vault,
        enc: {
          encSecretKey: new Uint8Array([1]),
          iv: new Uint8Array([2]),
          authTag: new Uint8Array([3]),
        },
        address: FROM,
      },
    ]);
    expect(balances.invalidateUserBalances).toHaveBeenCalledExactlyOnceWith(USER);
  });

  it("keeps the amount the send moved: Max is recomputed for the fee of the moment", async () => {
    const { service, rows } = harness({ send: success(BALANCE - 5_540n) });

    await service.execute(USER, "w1", TO, MAX);

    expect(rows[0]?.lamports).toBe(BALANCE - 5_540n);
  });

  it("records FAILED with the code and the detail, and keeps the signature it broadcast", async () => {
    const failure: TxFailure = {
      ok: false,
      code: "BLOCKHASH_EXPIRED",
      landed: "no",
      detail: "BlockhashNotFound",
    };
    const { service, rows, balances } = harness({ send: failure });

    const outcome = await service.execute(USER, "w1", TO, EXACT);

    expect(outcome).toMatchObject({
      status: "failed",
      failure,
      wallet: { id: "w1", name: "Main" },
    });
    expect(rows[0]).toMatchObject({
      status: "FAILED",
      error: "BLOCKHASH_EXPIRED: BlockhashNotFound",
      signature: SIGNATURE,
    });
    expect(balances.invalidateUserBalances).not.toHaveBeenCalled();
  });

  it("moves the balances when the transaction landed and failed: the fees were paid", async () => {
    const failure: TxFailure = {
      ok: false,
      code: "TRANSACTION_REJECTED",
      landed: "yes",
      signature: SIGNATURE,
    };
    const { service, rows, balances } = harness({ send: failure });

    await service.execute(USER, "w1", TO, EXACT);

    expect(rows[0]).toMatchObject({ status: "FAILED", error: "TRANSACTION_REJECTED" });
    expect(balances.invalidateUserBalances).toHaveBeenCalledOnce();
  });

  it("leaves an attempt of unknown outcome PENDING, with its signature", async () => {
    const failure: TxFailure = {
      ok: false,
      code: "CONFIRMATION_UNKNOWN",
      landed: "unknown",
      signature: SIGNATURE,
    };
    const { service, rows } = harness({ send: failure });

    const outcome = await service.execute(USER, "w1", TO, EXACT);

    expect(outcome).toMatchObject({ status: "failed", failure });
    expect(rows[0]).toMatchObject({ status: "PENDING", signature: SIGNATURE, error: null });
  });

  it("refuses the amount before any row when the quote refuses it", async () => {
    const failure: TxFailure = { ok: false, code: "INSUFFICIENT_FUNDS", landed: "no" };
    const { service, rows } = harness({ prepare: failure });

    expect(await service.execute(USER, "w1", TO, EXACT)).toEqual({ status: "refused", failure });
    expect(rows).toHaveLength(0);
  });

  it("refuses a second withdrawal while one is in flight, and sends nothing", async () => {
    const { service, transfer, rows } = harness({ rows: [{ status: "PENDING" }] });

    expect(await service.execute(USER, "w1", TO, MAX)).toEqual({ status: "in_progress" });
    expect(transfer.send).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("settles a stale PENDING row from the chain before a new one: landed, so CONFIRMED", async () => {
    const { service, rows, transfer } = harness({
      rows: [{ status: "PENDING", signature: "old-sig" }],
      now: T0.getTime() + WITHDRAWAL_IN_FLIGHT_MS,
      lookup: { status: "confirmed", slot: 9 },
    });

    const outcome = await service.execute(USER, "w1", TO, MAX);

    expect(rows[0]).toMatchObject({ status: "CONFIRMED", signature: "old-sig" });
    expect(transfer.lookup).toHaveBeenCalledExactlyOnceWith("old-sig");
    expect(outcome.status).toBe("sent");
    expect(rows).toHaveLength(2);
  });

  it("fails a stale PENDING row the chain never saw, or that was never sent", async () => {
    const expired = harness({
      rows: [{ status: "PENDING", signature: "old-sig" }],
      now: T0.getTime() + WITHDRAWAL_IN_FLIGHT_MS,
    });
    const neverSent = harness({
      rows: [{ status: "PENDING" }],
      now: T0.getTime() + WITHDRAWAL_IN_FLIGHT_MS,
    });

    await expired.service.execute(USER, "w1", TO, MAX);
    await neverSent.service.execute(USER, "w1", TO, MAX);

    expect(expired.rows[0]).toMatchObject({ status: "FAILED", error: "BLOCKHASH_EXPIRED" });
    expect(neverSent.rows[0]).toMatchObject({ status: "FAILED", error: "NEVER_SENT" });
  });

  it("stays in progress while the chain still votes on a stale attempt, or cannot say", async () => {
    for (const lookup of [{ status: "processed", slot: 1 }, { status: "unavailable" }] as const) {
      const { service, transfer } = harness({
        rows: [{ status: "PENDING", signature: "old-sig" }],
        now: T0.getTime() + WITHDRAWAL_IN_FLIGHT_MS,
        lookup,
      });

      expect(await service.execute(USER, "w1", TO, MAX)).toEqual({ status: "in_progress" });
      expect(transfer.send).not.toHaveBeenCalled();
    }
  });

  it("knows nothing of a wallet of another user", async () => {
    const { service, transfer } = harness();

    expect(await service.execute("u2", "w1", TO, MAX)).toEqual({ status: "not_found" });
    expect(transfer.send).not.toHaveBeenCalled();
  });
});

describe("resolve", () => {
  it("brings the PENDING attempt of the wallet up to date from the chain", async () => {
    const confirmed = harness({
      rows: [{ status: "PENDING", signature: "sig" }],
      lookup: { status: "confirmed", slot: 1 },
    });
    const landedFailed = harness({
      rows: [{ status: "PENDING", signature: "sig" }],
      lookup: { status: "failed", slot: 1, detail: "x" },
    });
    const young = harness({ rows: [{ status: "PENDING", signature: "sig" }] });

    expect((await confirmed.service.resolve(USER, "w1"))?.status).toBe("CONFIRMED");
    expect(confirmed.balances.invalidateUserBalances).toHaveBeenCalledOnce();
    expect(await landedFailed.service.resolve(USER, "w1")).toMatchObject({
      status: "FAILED",
      error: "TRANSACTION_REJECTED: x",
    });
    // Not found, but its blockhash may still be valid: nothing is decided yet.
    expect((await young.service.resolve(USER, "w1"))?.status).toBe("PENDING");
  });

  it("has nothing to say when no attempt is in flight, nor for another user", async () => {
    const settled = harness({ rows: [{ status: "CONFIRMED", signature: "sig" }] });
    const pending = harness({ rows: [{ status: "PENDING", signature: "sig" }] });

    expect(await settled.service.resolve(USER, "w1")).toBeNull();
    expect(settled.transfer.lookup).not.toHaveBeenCalled();
    expect(await pending.service.resolve("u2", "w1")).toBeNull();
  });
});
