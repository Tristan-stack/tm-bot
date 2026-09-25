import { getOffer, WITHDRAWAL_IN_FLIGHT_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import type { KeyVault, SignatureOutcome, TxFailure, TxSuccess } from "@launchbot/solana";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { testTransferQuote } from "../test-db.js";
import type { BalancesService, UserBalances, WalletBalance } from "./balances.js";
import type { InvoiceCheck, InvoiceView } from "./payments.js";
import { createWalletPaymentService } from "./wallet-payments.js";
import type { PayOptions, PayRequest } from "./wallet-payments.js";
import type { TransferApi } from "./withdrawals.js";

const NOW = new Date("2026-09-24T12:05:00Z");
const USER = "u1";
const PAYMENT = "p1";
const DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
/** $59 at $103.36 (§8.3). */
const EXPECTED = 570_820_434n;
const FEE = 15_000n;
const RENT_MIN = 890_880n;
const SIGNATURE = `5KtP${"1".repeat(80)}x9Qm`;
/** What the key columns hold in this test: recognisable bytes, so a log that leaks them shows. */
const KEYS = {
  encSecretKey: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
  iv: new Uint8Array([0x0b, 0xad, 0xf0, 0x0d]),
  authTag: new Uint8Array([0xfe, 0xed, 0xfa, 0xce]),
};

const walletOf = (id: string, lamports: bigint | null): WalletBalance => ({
  id,
  name: id === "w1" ? "Main" : "Test",
  publicKey:
    id === "w1"
      ? "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
      : "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81",
  createdAt: NOW,
  lamports,
});

const invoiceOf = (overrides: Partial<InvoiceView> = {}): InvoiceView => {
  const received = overrides.receivedLamports ?? 0n;
  return {
    id: PAYMENT,
    userId: USER,
    offer: getOffer("PREMIUM", "TWO_DAYS"),
    priceUsd: "59.00",
    solUsdRate: "103.36",
    expectedLamports: EXPECTED,
    receivedLamports: received,
    remainingLamports: EXPECTED - received,
    depositAddress: DEPOSIT,
    status: "PENDING",
    expiresAt: new Date(NOW.getTime() + 25 * 60_000),
    secondsLeft: 1_500,
    ...overrides,
  };
};

const awaiting = (invoice = invoiceOf()): InvoiceCheck => ({
  kind: invoice.receivedLamports > 0n ? "PARTIAL" : "NOT_DETECTED",
  invoice,
  checkedAt: NOW,
});
const activated: InvoiceCheck = {
  kind: "ACTIVATED",
  activatedNow: true,
  plan: "PREMIUM",
  expiresAt: new Date("2026-09-26T12:05:00Z"),
  invoice: invoiceOf({ status: "PAID", receivedLamports: EXPECTED }),
  checkedAt: NOW,
};

const success: TxSuccess = { ok: true, signature: SIGNATURE, slot: 42, feeLamports: FEE };
const failureOf = (landed: TxFailure["landed"], signature?: string): TxFailure => ({
  ok: false,
  code: landed === "unknown" ? "CONFIRMATION_UNKNOWN" : "TRANSACTION_REJECTED",
  landed,
  ...(signature === undefined ? {} : { signature }),
});

/** The invoice, the wallets, the lock and V1-13, from a script; the send records its calls. */
function harness(
  options: {
    invoice?: InvoiceView | null;
    /** Answers of `checkInvoice`, in order; the last one repeats. */
    checks?: InvoiceCheck[];
    wallets?: WalletBalance[];
    status?: UserBalances["status"];
    send?: TxSuccess | TxFailure;
    /** V1-13 refuses before reading or signing anything: `onPrepared` is never called. */
    refuse?: TxFailure;
    lockFree?: boolean;
    lookup?: SignatureOutcome;
  } = {},
) {
  const {
    invoice = invoiceOf(),
    checks = [awaiting(), activated],
    wallets = [walletOf("w1", 2_500_000_000n), walletOf("w2", 400_000_000n)],
    status = "fresh",
    send = success,
    lockFree = true,
  } = options;
  const answers = [...checks];

  const prisma = {
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work({ $queryRaw: () => Promise.resolve([{ locked: lockFree }]) }),
    ),
    wallet: {
      findFirst: vi.fn(({ where }: { where: { id: string; userId: string } }) => {
        const wallet = wallets.find((candidate) => candidate.id === where.id);
        if (where.userId !== USER || wallet === undefined) return Promise.resolve(null);
        const { id, name, publicKey, createdAt } = wallet;
        return Promise.resolve({ id, name, publicKey, createdAt, ...KEYS });
      }),
    },
  };
  const payments = {
    getInvoice: vi.fn(() => Promise.resolve(invoice)),
    checkInvoice: vi.fn(() => Promise.resolve(answers.length > 1 ? answers.shift()! : answers[0]!)),
  };
  const balances = {
    getUserBalances: vi.fn<BalancesService["getUserBalances"]>(() =>
      Promise.resolve({ wallets, totalLamports: null, fetchedAt: NOW, status }),
    ),
    invalidateUserBalances: vi.fn(),
  };
  const transfer = {
    estimateFee: vi.fn(() => Promise.resolve(FEE)),
    rentMin: vi.fn(() => Promise.resolve(RENT_MIN)),
    prepare: vi.fn<TransferApi["prepare"]>(),
    // What V1-13 does: read the wallet and price the send (`onPrepared`), then answer.
    send: vi.fn<TransferApi["send"]>(async (request, _signer, { onPrepared } = {}) => {
      if (options.refuse !== undefined) return options.refuse;
      const balance = wallets.find((wallet) => wallet.publicKey === request.from)?.lamports;
      await onPrepared?.(
        testTransferQuote({
          ...request,
          balanceLamports: balance ?? 0n,
          rentMinLamports: RENT_MIN,
        }),
      );
      return send;
    }),
    lookup: vi.fn(() => Promise.resolve(options.lookup ?? { status: "not_found" as const })),
  };
  const vault = {} as KeyVault;
  const service = createWalletPaymentService({
    prisma: prisma as unknown as PrismaClient,
    payments,
    balances,
    transfer,
    vault,
    now: () => NOW,
  });
  return { service, prisma, payments, balances, transfer, vault };
}

const REQUEST: PayRequest = { paymentId: PAYMENT, walletId: "w1", amountLamports: EXPECTED };

afterEach(() => {
  setLogDestination(undefined);
});

describe("what a wallet lacks (§8.3, on the rules of V1-13)", () => {
  const missingOf = async (lamports: bigint, invoice = invoiceOf()) => {
    const h = harness({ invoice, wallets: [walletOf("w1", lamports)] });
    const result = await h.service.listChoices(USER, PAYMENT);
    if (result.status !== "ok") throw new Error(result.status);
    return result.wallets[0]?.missingLamports;
  };

  it("nothing when the balance is the amount plus the fees, down to 0", async () => {
    expect(await missingOf(EXPECTED + FEE)).toBe(0n);
  });

  it("the amount plus the fees over the balance", async () => {
    expect(await missingOf(400_000_000n)).toBe(EXPECTED + FEE - 400_000_000n);
  });

  it("the rent-exempt minimum too when the balance left would fall under it", async () => {
    const balance = EXPECTED + FEE + RENT_MIN / 2n;
    expect(await missingOf(balance)).toBe(EXPECTED + FEE + RENT_MIN - balance);
  });

  it("the rest only, once part of the invoice arrived", async () => {
    const partial = invoiceOf({ receivedLamports: 300_000_000n });
    expect(await missingOf(EXPECTED - 300_000_000n + FEE, partial)).toBe(0n);
    expect(await missingOf(100_000_000n, partial)).toBe(
      EXPECTED - 300_000_000n + FEE - 100_000_000n,
    );
  });
});

describe("listChoices", () => {
  it("every wallet at its cached balance, one fee estimate on the deposit address", async () => {
    const h = harness({ wallets: [walletOf("w1", 2_500_000_000n), walletOf("w2", null)] });

    const result = await h.service.listChoices(USER, PAYMENT);

    expect(result).toMatchObject({
      status: "ok",
      feeLamports: FEE,
      wallets: [{ missingLamports: 0n }, { missingLamports: null }],
    });
    expect(h.balances.getUserBalances).toHaveBeenCalledWith(USER, { skipCache: false });
    expect(h.transfer.estimateFee).toHaveBeenCalledWith(DEPOSIT);
    expect(h.transfer.estimateFee).toHaveBeenCalledTimes(1);
  });

  it("an invoice that is not the user's: NOT_FOUND, nothing read", async () => {
    const h = harness({ invoice: null });

    expect(await h.service.listChoices(USER, PAYMENT)).toMatchObject({
      status: "blocked",
      check: { kind: "NOT_FOUND" },
    });
    expect(h.balances.getUserBalances).not.toHaveBeenCalled();
  });

  it("an invoice no longer pending: the check says how it ended", async () => {
    const h = harness({ invoice: invoiceOf({ status: "PAID" }), checks: [activated] });

    expect(await h.service.listChoices(USER, PAYMENT)).toEqual({
      status: "blocked",
      check: activated,
    });
  });
});

describe("quote", () => {
  it("reads the balances this very moment", async () => {
    const h = harness();

    const result = await h.service.quote(USER, PAYMENT, "w1");

    expect(result).toMatchObject({ status: "ok", feeLamports: FEE, wallet: { id: "w1" } });
    expect(h.balances.getUserBalances).toHaveBeenCalledWith(USER, { skipCache: true });
  });

  it("a wallet short of funds, with the list to draw again", async () => {
    const h = harness();

    expect(await h.service.quote(USER, PAYMENT, "w2")).toMatchObject({
      status: "insufficient",
      wallet: { id: "w2" },
      missingLamports: EXPECTED + FEE - 400_000_000n,
      wallets: [{ wallet: { id: "w1" } }, { wallet: { id: "w2" } }],
    });
  });

  it("refuses a wallet of another user, and a stale balance", async () => {
    expect(await harness().service.quote(USER, PAYMENT, "w9")).toMatchObject({
      status: "wallet_not_found",
      wallets: [{ wallet: { id: "w1" } }, { wallet: { id: "w2" } }],
    });
    expect(await harness({ status: "stale" }).service.quote(USER, PAYMENT, "w1")).toMatchObject({
      status: "balance_unavailable",
    });
  });
});

describe("pay", () => {
  it("sends the rest from the wallet to the deposit address, then checks the invoice", async () => {
    const h = harness();
    const onSending = vi.fn<NonNullable<PayOptions["onSending"]>>(() => Promise.resolve());

    const outcome = await h.service.pay(USER, REQUEST, { onSending });

    expect(outcome).toEqual({ status: "sent", check: activated });
    expect(h.transfer.send).toHaveBeenCalledWith(
      {
        from: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        to: DEPOSIT,
        mode: "exact",
        amountLamports: EXPECTED,
      },
      {
        kind: "vault",
        vault: h.vault,
        enc: KEYS,
        address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      },
      expect.anything(),
    );
    // Once V1-13 has read the wallet: the screen shows the balance it read.
    expect(onSending.mock.calls[0]).toMatchObject([{ wallet: { lamports: 2_500_000_000n } }]);
    expect(h.balances.invalidateUserBalances).toHaveBeenCalledWith(USER);
    expect(h.payments.checkInvoice).toHaveBeenCalledTimes(2);
  });

  it("sends only the rest of a partial payment", async () => {
    const partial = invoiceOf({ receivedLamports: 300_000_000n });
    const h = harness({ checks: [awaiting(partial), activated] });

    await h.service.pay(USER, { ...REQUEST, amountLamports: EXPECTED - 300_000_000n });

    expect(h.transfer.send.mock.calls[0]?.[0]).toMatchObject({
      amountLamports: EXPECTED - 300_000_000n,
    });
  });

  it.each([
    ["paid meanwhile", activated],
    ["expired", { kind: "EXPIRED", invoice: invoiceOf({ status: "EXPIRED" }), checkedAt: NOW }],
    ["canceled", { kind: "CANCELED", invoice: invoiceOf({ status: "CANCELED" }), checkedAt: NOW }],
    ["gone", { kind: "NOT_FOUND", checkedAt: NOW }],
  ] as [string, InvoiceCheck][])("never sends to an invoice %s", async (_case, check) => {
    const h = harness({ checks: [check] });

    expect(await h.service.pay(USER, REQUEST)).toEqual({ status: "blocked", check });
    expect(h.transfer.send).not.toHaveBeenCalled();
  });

  it("an amount that changed since the confirmation: the new quote, nothing sent", async () => {
    const partial = invoiceOf({ receivedLamports: 300_000_000n });
    const h = harness({ checks: [awaiting(partial)] });

    expect(await h.service.pay(USER, REQUEST)).toMatchObject({
      status: "amount_changed",
      invoice: { remainingLamports: EXPECTED - 300_000_000n },
    });
    expect(h.transfer.send).not.toHaveBeenCalled();
  });

  it("a balance that moved since the confirmation: V1-13 refuses, the list says what is missing", async () => {
    const h = harness({
      refuse: { ok: false, code: "INSUFFICIENT_FUNDS", landed: "no", missingLamports: 1n },
      checks: [awaiting()],
    });

    expect(await h.service.pay(USER, { ...REQUEST, walletId: "w2" })).toMatchObject({
      status: "insufficient",
      wallet: { id: "w2" },
      missingLamports: EXPECTED + FEE - 400_000_000n,
    });
    // Nothing left the wallet: the balances are not read again for nothing.
    expect(h.balances.invalidateUserBalances).not.toHaveBeenCalled();
  });

  it("a wallet of another user: nothing sent, the list says so", async () => {
    const h = harness();

    expect(await h.service.pay(USER, { ...REQUEST, walletId: "w9" })).toMatchObject({
      status: "wallet_not_found",
    });
    expect(h.transfer.send).not.toHaveBeenCalled();
  });

  it("reads the wallet once on Confirm: V1-13 reads its balance and prices the send", async () => {
    const h = harness();

    await h.service.pay(USER, REQUEST);

    expect(h.balances.getUserBalances).not.toHaveBeenCalled();
    expect(h.transfer.estimateFee).not.toHaveBeenCalled();
    expect(h.prisma.wallet.findFirst).toHaveBeenCalledTimes(1);
  });

  it("another payment of the invoice holds the lock: nothing read, nothing sent", async () => {
    const h = harness({ lockFree: false });

    expect(await h.service.pay(USER, REQUEST)).toEqual({ status: "locked" });
    expect(h.payments.checkInvoice).not.toHaveBeenCalled();
    expect(h.transfer.send).not.toHaveBeenCalled();
  });

  it("a failed send whose funds arrived anyway is a payment", async () => {
    const h = harness({ send: failureOf("yes") });

    expect(await h.service.pay(USER, REQUEST)).toEqual({ status: "sent", check: activated });
  });

  it("a rejected send: the failure, the invoice still open", async () => {
    const h = harness({ send: failureOf("no"), checks: [awaiting()] });

    expect(await h.service.pay(USER, REQUEST)).toMatchObject({
      status: "failed",
      failure: { code: "TRANSACTION_REJECTED", landed: "no" },
      wallet: { id: "w1", lamports: 2_500_000_000n },
    });
    expect(h.balances.invalidateUserBalances).not.toHaveBeenCalled();
  });

  it("an outcome unknown is never a failure: unconfirmed, with its signature", async () => {
    const h = harness({ send: failureOf("unknown", SIGNATURE), checks: [awaiting()] });

    expect(await h.service.pay(USER, REQUEST)).toMatchObject({
      status: "unconfirmed",
      signature: SIGNATURE,
      check: { kind: "NOT_DETECTED" },
    });
    expect(h.balances.invalidateUserBalances).toHaveBeenCalledWith(USER);
  });

  it.each([
    ["still in a block", { status: "processed", slot: 1 }, 0],
    ["not seen yet, within its window", { status: "not_found" }, WITHDRAWAL_IN_FLIGHT_MS - 1],
  ] as [string, SignatureOutcome, number][])(
    "a previous send %s: nothing sent again",
    async (_case, lookup, age) => {
      const h = harness({ lookup, checks: [awaiting()] });

      const outcome = await h.service.pay(USER, REQUEST, {
        inFlight: { signature: SIGNATURE, sentAt: NOW.getTime() - age },
      });

      expect(outcome).toMatchObject({ status: "unconfirmed", signature: SIGNATURE });
      expect(h.transfer.send).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["failed", { status: "failed", slot: 1 }, 0],
    ["never landed", { status: "not_found" }, WITHDRAWAL_IN_FLIGHT_MS],
  ] as [string, SignatureOutcome, number][])(
    "a previous send that %s: the payment goes",
    async (_case, lookup, age) => {
      const h = harness({ lookup });

      await h.service.pay(USER, REQUEST, {
        inFlight: { signature: SIGNATURE, sentAt: NOW.getTime() - age },
      });

      expect(h.transfer.send).toHaveBeenCalledTimes(1);
    },
  );

  it("a previous send that confirmed: the deposit counts it, nothing sent again", async () => {
    const h = harness({ lookup: { status: "confirmed", slot: 1 }, checks: [activated] });

    const outcome = await h.service.pay(USER, REQUEST, {
      inFlight: { signature: SIGNATURE, sentAt: NOW.getTime() },
    });

    expect(outcome).toEqual({ status: "blocked", check: activated });
    expect(h.transfer.send).not.toHaveBeenCalled();
  });

  it("logs ids, amounts and the signature only: never the key columns", async () => {
    const lines = captureLogs();

    await harness().service.pay(USER, REQUEST);
    await harness({ send: failureOf("no"), checks: [awaiting()] }).service.pay(USER, REQUEST);

    const logs = lines.join("\n");
    expect(logs).toContain("payment.wallet_sent");
    expect(logs).toContain("payment.wallet_failed");
    expect(logs).toContain(SIGNATURE);
    for (const word of ["encSecretKey", "authTag", "deadbeef", "222,173", "0badf00d"]) {
      expect(logs).not.toContain(word);
    }
    expect(logs).not.toMatch(/"iv"/);
  });
});
