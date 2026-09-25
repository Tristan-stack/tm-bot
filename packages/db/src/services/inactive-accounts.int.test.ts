import {
  DAY_MS,
  HOUR_MS,
  INACTIVITY_DELETE_MS,
  inactivityCutoff,
  MINUTE_MS,
} from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { createKeyVault } from "@launchbot/solana";
import type { SignatureOutcome, TxFailure, TxSuccess } from "@launchbot/solana";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient, User } from "../generated/prisma/client.js";
import {
  fakeChain,
  resetTestDatabase,
  testPaymentData,
  testTransferQuote,
  testWalletData,
} from "../test-db.js";
import { createAccountDeletionService } from "./account-deletion.js";
import { createAccountSweeper } from "./account-sweep.js";
import type { SweepKind } from "./account-sweep.js";
import { createInactiveAccountsService } from "./inactive-accounts.js";
import type { TransferApi } from "./withdrawals.js";

const TREASURY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MAIN = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TEST = "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81";
const FEE = 5_000n;
/** At least the fees of a transfer, as `getWithdrawFeeBudgetLamports` is. */
const FEE_BUDGET = 20_000n;
const SOL = 1_000_000_000n;
const START = new Date("2026-09-24T12:00:00Z");
/** An hour past the delay of inactivity, an hour short of it. */
const IDLE = INACTIVITY_DELETE_MS + HOUR_MS;
const RECENT = INACTIVITY_DELETE_MS - HOUR_MS;

type Outcome = "ok" | "failed" | "unknown";

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("sweeps to the treasury (db, V1-44, V1-45)", () => {
  let prisma: PrismaClient;
  const { lamports: chain, read } = fakeChain();
  let clock = START;
  let failRead = false;
  let nextTelegramId = 6_100_000n;
  const lookups = new Map<string, SignatureOutcome>();

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("inactive"));
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
    await prisma.payment.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    setLogDestination(undefined);
  });

  /**
   * V1-13 on the fake chain: `max` moves the balance minus the fees, checked and moved in one go
   * so two transfers in parallel move it once. `failed` sends nothing; `unknown` lands but the
   * send cannot say so. `onSent` runs once the transaction is out (a user coming back).
   */
  function services(options: { outcomes?: Outcome[]; onSent?: () => Promise<void> } = {}) {
    const outcomes = [...(options.outcomes ?? [])];
    let sent = 0;
    const send = vi.fn<TransferApi["send"]>(async (request, _signer, callbacks = {}) => {
      const balance = chain.get(request.from) ?? 0n;
      if (balance <= FEE) {
        return { ok: false, code: "INSUFFICIENT_FUNDS", landed: "no" } satisfies TxFailure;
      }
      const outcome = outcomes.shift() ?? "ok";
      const amount = balance - FEE;
      if (outcome !== "failed") {
        chain.set(request.from, 0n);
        chain.set(request.to, (chain.get(request.to) ?? 0n) + amount);
      }
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
      sent += 1;
      const signature = `sweep-${sent}-${request.from}`;
      await callbacks.onSubmitted?.(signature);
      await options.onSent?.();
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
    const readLamports = (addresses: readonly string[]) =>
      failRead ? Promise.reject(new Error("RPC down")) : read(addresses);
    const deletion = createAccountDeletionService({
      prisma,
      readLamports,
      feeBudgetLamports: FEE_BUDGET,
      now: () => clock,
    });
    const sweeperDeps = {
      prisma,
      transfer: { send, lookup },
      vault: createKeyVault(new Uint8Array(32)),
      readLamports,
      treasury: TREASURY,
      feeBudgetLamports: FEE_BUDGET,
      now: () => clock,
    };
    const accounts = createInactiveAccountsService({ ...sweeperDeps, deletion });
    return { accounts, sweeper: createAccountSweeper(sweeperDeps), send, lookup };
  }

  /** An account whose last activity was `ago` before the start of the pass. */
  async function account(ago: number, wallets: [string, string, bigint][] = []): Promise<User> {
    const user = await prisma.user.create({
      data: {
        telegramId: nextTelegramId++,
        username: "otter_fan",
        lastActiveAt: new Date(START.getTime() - ago),
      },
    });
    let index = 0;
    for (const [name, address, lamports] of wallets) {
      chain.set(address, lamports);
      await prisma.wallet.create({
        data: {
          ...testWalletData(user.id, name, address),
          createdAt: new Date(START.getTime() - DAY_MS * 10 + index++ * MINUTE_MS),
        },
      });
    }
    return user;
  }

  const cutoff = inactivityCutoff(START);
  const candidate = async (user: User) =>
    (await services().accounts.listCandidates(cutoff, [])).find((row) => row.id === user.id)!;
  const sweepsOf = (telegramId: bigint) =>
    prisma.withdrawal.findMany({
      where: { kind: "INACTIVITY_SWEEP", userTelegramId: telegramId },
      orderBy: { createdAt: "asc" },
    });

  it("lists the accounts inactive for 24 h, an admin excepted, by pages", async () => {
    const old = await account(IDLE);
    await account(RECENT);
    const admin = await account(IDLE);
    const { accounts } = services();

    expect((await accounts.listCandidates(cutoff, [])).map((user) => user.id).sort()).toEqual(
      [old.id, admin.id].sort(),
    );
    const exempt = [Number(admin.telegramId)];
    expect((await accounts.listCandidates(cutoff, exempt)).map((user) => user.id)).toEqual([
      old.id,
    ]);
    // After the last row of a page: nothing left.
    const [last] = await accounts.listCandidates(cutoff, exempt);
    expect(await accounts.listCandidates(cutoff, exempt, last)).toEqual([]);
  });

  it("moves the SOL to the treasury, then deletes the account and keeps the books", async () => {
    const user = await account(IDLE, [["Main", MAIN, SOL]]);
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: "PREMIUM",
        duration: "ONE_MONTH",
        startsAt: new Date(START.getTime() - DAY_MS),
        expiresAt: new Date(START.getTime() + DAY_MS),
      },
    });
    const invoice = await prisma.payment.create({
      data: testPaymentData(user.id, "DEPOSIT_INACTIVE", {
        expiresAt: new Date(START.getTime() + 10 * MINUTE_MS),
      }),
    });
    const { accounts, send } = services();

    const outcome = await accounts.processAccount(await candidate(user), cutoff);

    expect(outcome).toMatchObject({
      status: "DELETED",
      transfers: [{ walletName: "Main", fromAddress: MAIN, lamports: SOL - FEE }],
    });
    expect(send).toHaveBeenCalledOnce();
    expect(chain.get(TREASURY)).toBe(SOL - FEE);
    expect(await sweepsOf(user.telegramId)).toEqual([
      expect.objectContaining({
        status: "CONFIRMED",
        userId: null,
        walletId: null,
        fromAddress: MAIN,
        toAddress: TREASURY,
        lamports: SOL - FEE,
        feeLamports: FEE,
      }),
    ]);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      userId: null,
    });
  });

  it("leaves dust where it is: no transfer, the account is deleted", async () => {
    const user = await account(IDLE, [["Main", MAIN, FEE_BUDGET]]);
    const { accounts, send } = services();

    expect(await accounts.processAccount(await candidate(user), cutoff)).toMatchObject({
      status: "DELETED",
      transfers: [],
    });
    expect(send).not.toHaveBeenCalled();
    expect(await sweepsOf(user.telegramId)).toEqual([]);
  });

  it("keeps the account while a wallet fails, and never moves a wallet twice", async () => {
    const user = await account(IDLE, [
      ["Main", MAIN, SOL],
      ["Test", TEST, 2n * SOL],
    ]);

    const first = services({ outcomes: ["ok", "failed"] });
    expect(await first.accounts.processAccount(await candidate(user), cutoff)).toMatchObject({
      status: "KEPT",
      reason: "TX_FAILED",
      transfers: [{ walletName: "Main" }],
    });
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);

    // The next pass, 15 minutes later.
    clock = new Date(START.getTime() + 15 * MINUTE_MS);
    const second = services();
    expect(await second.accounts.processAccount(await candidate(user), cutoff)).toMatchObject({
      status: "DELETED",
      transfers: [{ walletName: "Test", lamports: 2n * SOL - FEE }],
    });
    expect(second.send).toHaveBeenCalledOnce();
    const rows = await sweepsOf(user.telegramId);
    expect(
      rows.map((row) => `${row.fromAddress === MAIN ? "Main" : "Test"} ${row.status}`).sort(),
    ).toEqual(["Main CONFIRMED", "Test CONFIRMED", "Test FAILED"]);
  });

  it("moves nothing when the balances cannot be read", async () => {
    const user = await account(IDLE, [["Main", MAIN, SOL]]);
    failRead = true;
    const { accounts, send } = services();

    expect(await accounts.processAccount(await candidate(user), cutoff)).toMatchObject({
      status: "KEPT",
      reason: "READ_FAILED",
    });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });

  it("an unknown outcome stays PENDING, then is confirmed from the chain, never sent again", async () => {
    const user = await account(IDLE, [["Main", MAIN, SOL]]);
    const first = services({ outcomes: ["unknown"] });

    expect(await first.accounts.processAccount(await candidate(user), cutoff)).toMatchObject({
      status: "KEPT",
      reason: "TX_PENDING",
    });
    const [pending] = await sweepsOf(user.telegramId);
    expect(pending).toMatchObject({ status: "PENDING" });

    // The next pass: the chain says it landed.
    clock = new Date(START.getTime() + 15 * MINUTE_MS);
    lookups.set(pending!.signature!, { status: "confirmed", slot: 9 });
    const second = services();
    expect(await second.accounts.resolvePendingSweeps()).toEqual({
      confirmed: 1,
      failed: 0,
      unresolved: 0,
    });
    expect(
      await second.accounts.processAccount(await candidate(user), inactivityCutoff(clock)),
    ).toMatchObject({ status: "DELETED", transfers: [] });
    expect(second.send).not.toHaveBeenCalled();
    expect(await sweepsOf(user.telegramId)).toMatchObject([{ status: "CONFIRMED" }]);
  });

  it("resolves the sweeps left PENDING by what the chain says, a purge's too", async () => {
    const user = await account(HOUR_MS);
    const row = (
      signature: string | null,
      minutesAgo: number,
      kind: SweepKind = "INACTIVITY_SWEEP",
    ) =>
      prisma.withdrawal.create({
        data: {
          userId: user.id,
          fromAddress: MAIN,
          toAddress: TREASURY,
          lamports: SOL,
          signature,
          kind,
          userTelegramId: user.telegramId,
          createdAt: new Date(START.getTime() - minutesAgo * MINUTE_MS),
        },
      });
    const landed = await row("sig-landed", 10);
    const rejected = await row("sig-rejected", 10);
    const lost = await row("sig-lost", 10);
    const unsigned = await row(null, 10);
    const unknown = await row("sig-unknown", 10);
    // A /purge stopped on a transfer in flight, and never tried again.
    const purged = await row("sig-purged", 10, "PURGE_SWEEP");
    lookups.set("sig-landed", { status: "confirmed", slot: 1 });
    lookups.set("sig-rejected", { status: "failed", slot: 1, detail: "custom program error" });
    lookups.set("sig-unknown", { status: "unavailable" });
    lookups.set("sig-purged", { status: "confirmed", slot: 2 });

    expect(await services().accounts.resolvePendingSweeps()).toEqual({
      confirmed: 2,
      failed: 3,
      unresolved: 1,
    });
    const statusOf = async (id: string) =>
      (await prisma.withdrawal.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(purged.id)).toBe("CONFIRMED");
    expect(await statusOf(landed.id)).toBe("CONFIRMED");
    expect(await statusOf(rejected.id)).toBe("FAILED");
    expect(await statusOf(lost.id)).toBe("FAILED");
    expect(await statusOf(unsigned.id)).toBe("FAILED");
    expect(await statusOf(unknown.id)).toBe("PENDING");
  });

  it("a user back during the transfer keeps the account, with the SOL moved", async () => {
    const user = await account(IDLE, [["Main", MAIN, SOL]]);
    const back = () =>
      prisma.user
        .update({ where: { id: user.id }, data: { lastActiveAt: START } })
        .then(() => undefined);
    const { accounts } = services({ onSent: back });

    expect(await accounts.processAccount(await candidate(user), cutoff)).toMatchObject({
      status: "ACTIVE",
      transfers: [{ walletName: "Main", lamports: SOL - FEE }],
    });
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });

  it("two passes at once move the SOL once and delete once", async () => {
    const user = await account(IDLE, [["Main", MAIN, SOL]]);
    const found = await candidate(user);
    const { accounts, send } = services();

    const outcomes = await Promise.all([
      accounts.processAccount(found, cutoff),
      accounts.processAccount(found, cutoff),
    ]);

    expect(chain.get(TREASURY)).toBe(SOL - FEE);
    expect(outcomes.filter((outcome) => outcome.status === "DELETED")).toHaveLength(1);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(
      (await sweepsOf(user.telegramId)).filter((row) => row.status === "CONFIRMED"),
    ).toHaveLength(1);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
  });

  it("a purge moves the SOL of an active account, as PURGE_SWEEP rows, dust left", async () => {
    // Active a minute ago: a purge reads no activity, the user asked for the deletion.
    const user = await account(MINUTE_MS, [
      ["Main", MAIN, SOL],
      ["Test", TEST, FEE_BUDGET],
    ]);
    const { sweeper, send } = services();

    expect(await sweeper.sweepAccount(user, { kind: "PURGE_SWEEP" })).toMatchObject({
      status: "SWEPT",
      transfers: [{ walletName: "Main", fromAddress: MAIN, lamports: SOL - FEE }],
    });
    expect(send).toHaveBeenCalledOnce();
    expect(chain.get(TREASURY)).toBe(SOL - FEE);
    expect(chain.get(TEST)).toBe(FEE_BUDGET);
    expect(
      await prisma.withdrawal.findMany({ where: { userTelegramId: user.telegramId } }),
    ).toEqual([
      expect.objectContaining({
        kind: "PURGE_SWEEP",
        status: "CONFIRMED",
        userId: user.id,
        fromAddress: MAIN,
        toAddress: TREASURY,
      }),
    ]);
  });

  it("a purge keeps every key when a transfer fails, and says what moved", async () => {
    const logs = captureLogs();
    const user = await account(MINUTE_MS, [
      ["Main", MAIN, SOL],
      ["Test", TEST, 2n * SOL],
    ]);
    const { sweeper } = services({ outcomes: ["ok", "failed"] });

    expect(await sweeper.sweepAccount(user, { kind: "PURGE_SWEEP" })).toMatchObject({
      status: "KEPT",
      reason: "TX_FAILED",
      transfers: [{ walletName: "Main" }],
    });
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(2);
    expect(logs.join("\n")).toContain("purge.sweep");
  });

  it("logs no key, no username and no full address", async () => {
    const logs = captureLogs();
    const user = await account(IDLE, [
      ["Main", MAIN, SOL],
      ["Test", TEST, SOL],
    ]);
    const { accounts } = services({ outcomes: ["ok", "failed"] });

    await accounts.processAccount(await candidate(user), cutoff);

    const text = logs.join("\n");
    expect(text).toContain("inactive.sweep");
    for (const secret of [MAIN, TEST, "otter_fan", "encSecretKey", "authTag"]) {
      expect(text).not.toContain(secret);
    }
  });
});
