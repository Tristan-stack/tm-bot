import { DAY_MS, HOUR_MS, MINUTE_MS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { createKeyVault } from "@launchbot/solana";
import type { SignatureOutcome, TxFailure, TxSuccess } from "@launchbot/solana";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { fakeChain, fundedInvoice, resetTestDatabase, testTransferQuote } from "../test-db.js";
import { createTreasuryService } from "./treasury.js";
import type { TransferApi } from "./withdrawals.js";

const TREASURY = "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81";
const EXPECTED = 570_820_434n;
const FEE = 15_000n;
/** At least the fees of a transfer, as `getWithdrawFeeBudgetLamports` is. */
const FEE_BUDGET = 20_000n;

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("treasury service (db, V1-33)", () => {
  let prisma: PrismaClient;
  const { lamports: chain, read } = fakeChain();
  let clock = new Date("2026-09-12T14:32:00Z");

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("treasury"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // The watch and the purge read every invoice: each test starts from empty tables.
  beforeEach(async () => {
    chain.clear();
    clock = new Date("2026-09-12T14:32:00Z");
    await prisma.withdrawal.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.payment.deleteMany();
  });

  afterEach(() => {
    setLogDestination(undefined);
  });

  const later = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  /**
   * A V1-13 on the fake chain: `max` moves the balance minus the fees, or ends as scripted —
   * `failed` (nothing sent) or `unknown` (broadcast, outcome unknown, nothing moved yet).
   */
  function services(outcomes: ("ok" | "failed" | "unknown")[] = []) {
    let sent = 0;
    const send = vi.fn<TransferApi["send"]>(async (request, _signer, options = {}) => {
      const balance = chain.get(request.from) ?? 0n;
      const amount = balance - FEE;
      await options.onPrepared?.(
        testTransferQuote({
          from: request.from,
          to: request.to,
          mode: "max",
          amountLamports: amount,
          balanceLamports: balance,
          fee: { ...testTransferQuote().fee, totalFeeLamports: FEE },
        }),
      );
      const outcome = outcomes.shift() ?? "ok";
      if (outcome === "failed") {
        return { ok: false, code: "TRANSACTION_REJECTED", landed: "no" } satisfies TxFailure;
      }
      sent += 1;
      const signature = `sweep-${sent}-${request.from}`;
      await options.onSubmitted?.(signature);
      if (outcome === "unknown") {
        return {
          ok: false,
          code: "CONFIRMATION_UNKNOWN",
          landed: "unknown",
          signature,
        } satisfies TxFailure;
      }
      chain.set(request.from, 0n);
      chain.set(request.to, (chain.get(request.to) ?? 0n) + amount);
      return {
        ok: true,
        signature,
        slot: 1,
        feeLamports: FEE,
        amountLamports: amount,
      } satisfies TxSuccess;
    });
    const lookup = vi.fn<TransferApi["lookup"]>(() =>
      Promise.resolve<SignatureOutcome>({ status: "not_found" }),
    );
    const treasury = createTreasuryService({
      prisma,
      transfer: { send, lookup },
      vault: createKeyVault(new Uint8Array(32)),
      readLamports: read,
      treasury: TREASURY,
      feeBudgetLamports: FEE_BUDGET,
      findSender: () => Promise.resolve(null),
      now: () => clock,
    });
    return { treasury, send, lookup };
  }

  /** An invoice with a key, ended at the clock, its deposit funded on the fake chain. */
  async function invoice(
    status: "PENDING" | "PAID" | "EXPIRED" | "CANCELED" | "SWEPT",
    balance: bigint,
    overrides: Parameters<typeof fundedInvoice>[3] = {},
  ) {
    const { row } = await fundedInvoice(prisma, chain, balance, {
      status,
      expiresAt: clock,
      receivedLamports: status === "PAID" ? EXPECTED : 0n,
      ...overrides,
    });
    return row;
  }

  const reload = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });
  const sweepsOf = (fromAddress: string) =>
    prisma.withdrawal.findMany({ where: { fromAddress }, orderBy: { createdAt: "asc" } });

  it("moves a PAID deposit to the treasury: SWEPT, its signature, no alert", async () => {
    const paid = await invoice("PAID", EXPECTED + 50_000n);
    const { treasury } = services();

    const result = await treasury.sweepDeposit(paid.id);

    expect(result).toMatchObject({ kind: "SWEPT", depositCase: "PAID", alert: null });
    const row = await reload(paid.id);
    expect(row).toMatchObject({ status: "SWEPT", receivedLamports: EXPECTED + 50_000n });
    expect(row.sweepSignature).toBe(result.kind === "SWEPT" ? result.signature : null);
    expect(chain.get(TREASURY)).toBe(EXPECTED + 50_000n - FEE);
    expect(chain.get(paid.depositAddress)).toBe(0n);
    expect(await sweepsOf(paid.depositAddress)).toEqual([
      expect.objectContaining({ kind: "DEPOSIT_SWEEP", status: "CONFIRMED", toAddress: TREASURY }),
    ]);
  });

  it("keeps the invoice PAID when the transfer fails", async () => {
    const paid = await invoice("PAID", EXPECTED);
    const { treasury } = services(["failed"]);

    await expect(treasury.sweepDeposit(paid.id)).resolves.toEqual({
      kind: "FAILED",
      reason: "TRANSACTION_REJECTED",
    });
    expect(await reload(paid.id)).toMatchObject({ status: "PAID", sweepSignature: null });
    expect(await sweepsOf(paid.depositAddress)).toEqual([
      expect.objectContaining({ status: "FAILED", error: "TRANSACTION_REJECTED" }),
    ]);
  });

  it("an outcome it could not learn is looked up, never sent a second time", async () => {
    const paid = await invoice("PAID", EXPECTED);
    const { treasury, send, lookup } = services(["unknown"]);

    await expect(treasury.sweepDeposit(paid.id)).resolves.toMatchObject({ kind: "FAILED" });
    const [pending] = await sweepsOf(paid.depositAddress);
    expect(pending).toMatchObject({ status: "PENDING", signature: expect.any(String) as unknown });

    // Still young, unknown to the cluster: it may land, nothing is signed over it.
    await expect(treasury.sweepDeposit(paid.id)).resolves.toEqual({ kind: "IN_FLIGHT" });
    expect(send).toHaveBeenCalledOnce();

    // It landed after all: recorded from the chain, still one send.
    lookup.mockResolvedValue({ status: "confirmed", slot: 7 });
    await expect(treasury.sweepDeposit(paid.id)).resolves.toMatchObject({
      kind: "SWEPT",
      signature: pending?.signature,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(await reload(paid.id)).toMatchObject({ status: "SWEPT" });
  });

  it("tells the admins once when it gives up, again only after a transfer succeeds", async () => {
    const paid = await invoice("PAID", EXPECTED);
    const { treasury } = services(["failed"]);

    await expect(treasury.failureAlert(paid.id, "RPC_UNAVAILABLE", 9)).resolves.toMatchObject({
      kind: "SWEEP_FAILED",
      reason: "RPC_UNAVAILABLE",
      attempts: 9,
      balanceLamports: EXPECTED,
    });
    await expect(treasury.failureAlert(paid.id, "RPC_UNAVAILABLE", 9)).resolves.toBeNull();

    await treasury.sweepDeposit(paid.id); // failed
    await treasury.sweepDeposit(paid.id); // moved
    expect(await reload(paid.id)).toMatchObject({ status: "SWEPT", sweepAlertedAt: null });
  });

  it("never empties an expired address within its 24 h, then refunds by hand", async () => {
    const partial = await invoice("EXPIRED", 300_000_000n, { receivedLamports: 300_000_000n });
    const { treasury, send } = services();

    later(23 * HOUR_MS);
    await expect(treasury.sweepDeposit(partial.id)).resolves.toEqual({ kind: "NOTHING_TO_SWEEP" });
    expect(await treasury.watch(clock)).not.toContain(partial.id);
    expect(send).not.toHaveBeenCalled();

    later(HOUR_MS + 2 * MINUTE_MS);
    expect(await treasury.watch(clock)).toContain(partial.id);
    const result = await treasury.sweepDeposit(partial.id);

    expect(result).toMatchObject({
      kind: "SWEPT",
      depositCase: "PARTIAL_EXPIRED",
      alert: {
        kind: "PARTIAL_EXPIRED",
        balanceLamports: 300_000_000n,
        movedLamports: 300_000_000n - FEE,
      },
    });
    // Not paid: the status stays, the transfer is on file.
    const row = await reload(partial.id);
    expect(row.status).toBe("EXPIRED");
    expect(row.sweepSignature).not.toBeNull();
  });

  it("a full payment after the 24 h is a manual refund too, nothing activated", async () => {
    const late = await invoice("CANCELED", EXPECTED, { canceledAt: clock });
    const { treasury } = services();

    later(DAY_MS + 3 * MINUTE_MS);

    await expect(treasury.sweepDeposit(late.id)).resolves.toMatchObject({
      depositCase: "LATE_FULL_PAYMENT",
    });
    expect(await prisma.subscription.count({ where: { paymentId: late.id } })).toBe(0);
  });

  it("funds on an address moved already are an OLD_ADDRESS, counted with the rest", async () => {
    const swept = await invoice("SWEPT", 10_000_000n, {
      receivedLamports: EXPECTED,
      sweepSignature: "first-sweep",
    });
    const { treasury } = services();

    later(HOUR_MS);
    expect(await treasury.watch(clock)).toEqual([swept.id]);
    await expect(treasury.sweepDeposit(swept.id)).resolves.toMatchObject({
      depositCase: "OLD_ADDRESS",
      alert: { kind: "OLD_ADDRESS", invoice: { status: "SWEPT" } },
    });
    expect((await reload(swept.id)).receivedLamports).toBe(EXPECTED + 10_000_000n);
  });

  it("leaves dust and PENDING invoices alone", async () => {
    const dust = await invoice("SWEPT", FEE + 5_000n);
    const open = await invoice("PENDING", EXPECTED, {
      expiresAt: new Date(clock.getTime() + MINUTE_MS),
    });
    const { treasury, send } = services();

    later(HOUR_MS);
    expect(await treasury.watch(clock)).not.toContain(dust.id);
    await expect(treasury.sweepDeposit(dust.id)).resolves.toEqual({ kind: "NOTHING_TO_SWEEP" });
    await expect(treasury.sweepDeposit(open.id)).resolves.toEqual({ kind: "NOTHING_TO_SWEEP" });
    expect(send).not.toHaveBeenCalled();
  });

  it("erases the keys past 30 days, moves funds first, never erases an unmoved PAID", async () => {
    const empty = await invoice("SWEPT", 0n);
    const funded = await invoice("EXPIRED", 20_000_000n);
    const unmoved = await invoice("PAID", 0n);
    const { treasury } = services();

    later(30 * DAY_MS);
    const purge = await treasury.purgeKeys(clock);

    expect(purge.purged).toBe(1);
    expect(purge.sweep).toContain(funded.id);
    expect(purge.alerts).toEqual([
      expect.objectContaining({ kind: "SWEEP_FAILED", reason: "NEVER_SWEPT", attempts: null }),
    ]);
    expect(await reload(empty.id)).toMatchObject({
      encSecretKey: null,
      iv: null,
      authTag: null,
      keyDeletedAt: clock,
      status: "SWEPT",
      depositAddress: empty.depositAddress,
    });
    expect((await reload(funded.id)).encSecretKey).not.toBeNull();
    expect((await reload(unmoved.id)).encSecretKey).not.toBeNull();

    // The alert of the unmoved PAID goes once.
    const again = await treasury.purgeKeys(clock);
    expect(again.alerts.map((alert) => alert.invoice.depositAddress)).not.toContain(
      unmoved.depositAddress,
    );
  });

  it("never logs a key column", async () => {
    const lines = captureLogs();
    const paid = await invoice("PAID", EXPECTED);
    const { treasury } = services(["failed"]);

    await treasury.sweepDeposit(paid.id);
    await treasury.sweepDeposit(paid.id);
    await treasury.failureAlert(paid.id, "RPC_UNAVAILABLE", 9);

    const logged = lines.join("");
    expect(logged).toContain("payment.swept");
    for (const column of ["encSecretKey", "authTag", '"iv"']) expect(logged).not.toContain(column);
  });
});
