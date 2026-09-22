import { SecretBytes } from "@launchbot/solana";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client.js";
import type { Plan, PrismaClient } from "../generated/prisma/client.js";
import { createWalletService } from "./wallets.js";
import type { GeneratedWallet } from "./wallets.js";

const T0 = new Date("2026-09-21T12:00:00Z");
const USER = "u1";
const MNEMONIC = `${"abandon ".repeat(11)}about`;
const ADDRESS = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";
/** `getWithdrawFeeBudgetLamports(1_000_000)`: 5 000 base + 1 000 priority. */
const FEE_BUDGET = 6_000n;

type Columns = { userId: string; name: string; publicKey: string } & Record<string, unknown>;
type Row = Columns & { id: string; createdAt: Date };

const uniqueViolation = (fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError("failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { modelName: "Wallet", target: fields },
  });

const bytes = (label: string) => Uint8Array.from(Buffer.from(label));

/**
 * The wallet table and the subscription read, in memory. `$transaction` runs the callbacks one
 * after the other: what the advisory lock does in PostgreSQL (the integration test covers it).
 */
type Where = { userId: string; id?: string };

function harness(
  options: {
    names?: string[];
    plan?: Plan | null;
    failCreates?: Error[];
    failUpdates?: Error[];
    /** Lamports of every wallet (1 000 000 by default), and how the read went. */
    lamports?: bigint;
    balancesStatus?: "fresh" | "stale" | "unavailable";
    pendingWithdrawals?: number;
  } = {},
) {
  const {
    plan = null,
    failCreates = [],
    failUpdates = [],
    lamports = 1_000_000n,
    balancesStatus = "fresh",
    pendingWithdrawals = 0,
  } = options;
  const rows: Row[] = (options.names ?? []).map((name, index) => ({
    id: `w${index + 1}`,
    userId: USER,
    name,
    publicKey: `pk-${index + 1}`,
    createdAt: T0,
  }));
  const ofUser = (where: Where) =>
    rows.filter(
      (row) => row.userId === where.userId && (where.id === undefined || row.id === where.id),
    );

  const prisma = {
    wallet: {
      count: ({ where }: { where: Where }) => Promise.resolve(ofUser(where).length),
      findMany: ({ where, select }: { where: Where; select: Record<string, true> }) =>
        Promise.resolve(
          ofUser(where).map((row) =>
            Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])),
          ),
        ),
      updateMany: vi.fn(({ where, data }: { where: Where; data: { name: string } }) => {
        const failure = failUpdates.shift();
        if (failure !== undefined) return Promise.reject(failure);
        const matching = ofUser(where);
        for (const row of matching) row.name = data.name;
        return Promise.resolve({ count: matching.length });
      }),
      deleteMany: vi.fn(({ where }: { where: Where }) => {
        const matching = ofUser(where);
        for (const row of matching) rows.splice(rows.indexOf(row), 1);
        return Promise.resolve({ count: matching.length });
      }),
      create: vi.fn(({ data }: { data: Columns }) => {
        const failure = failCreates.shift();
        if (failure !== undefined) return Promise.reject(failure);
        const row: Row = { id: `w${rows.length + 1}`, createdAt: T0, ...data };
        rows.push(row);
        const { id, name, publicKey, createdAt } = row;
        return Promise.resolve({ id, name, publicKey, createdAt });
      }),
    },
    subscription: {
      findFirst: () => Promise.resolve(plan === null ? null : { plan }),
    },
    withdrawal: {
      count: vi.fn(() => Promise.resolve(pendingWithdrawals)),
    },
    $executeRaw: vi.fn(() => Promise.resolve(1)),
    $transaction: <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = queue.then(() => fn(prisma));
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  let queue: Promise<void> = Promise.resolve();

  const balances = {
    getUserBalances: vi.fn((userId: string) => {
      const known = balancesStatus === "unavailable" ? null : lamports;
      const wallets = ofUser({ userId }).map(({ id, name, publicKey, createdAt }) => ({
        id,
        name,
        publicKey,
        createdAt,
        lamports: known,
      }));
      return Promise.resolve({
        wallets,
        totalLamports: known === null ? null : BigInt(wallets.length) * known,
        fetchedAt: T0,
        status: balancesStatus,
      });
    }),
    invalidateUserBalances: vi.fn(),
  };
  const secretKeys: Uint8Array[] = [];
  const generateWallet = vi.fn((): GeneratedWallet => {
    const secretKey = SecretBytes.take(new Uint8Array(64).fill(7));
    secretKeys.push(secretKey);
    return { mnemonic: MNEMONIC, address: ADDRESS, secretKey, derivationPath: "m/44'/501'/0'/0'" };
  });
  // The fake ciphertext names its input: the test can see what was bound to what.
  const vault = {
    encrypt: vi.fn((secretKey: Uint8Array, address: string) => ({
      encSecretKey: bytes(`key:${secretKey.length}:${address}`),
      iv: bytes("iv"),
      authTag: bytes("tag"),
    })),
    encryptMnemonic: vi.fn((mnemonic: string, address: string) => ({
      encMnemonic: bytes(`mnemonic:${mnemonic}:${address}`),
      mnemonicIv: bytes("miv"),
      mnemonicAuthTag: bytes("mtag"),
    })),
  };

  const service = createWalletService({
    prisma: prisma as unknown as PrismaClient,
    balances,
    generateWallet,
    vault,
    withdrawFeeBudgetLamports: FEE_BUDGET,
    now: () => T0.getTime(),
  });
  return { ...service, rows, prisma, balances, generateWallet, vault, secretKeys };
}

describe("nextDefaultName", () => {
  it.each([
    [[], "Wallet 1"],
    [["Main", "Test"], "Wallet 3"],
    [["Main", "Wallet 3"], "Wallet 4"],
    [["Wallet 2", "Wallet 3", "Wallet 4"], "Wallet 5"],
  ])("names the next wallet after %j: %s", async (names, expected) => {
    expect(await harness({ names }).nextDefaultName(USER)).toBe(expected);
  });
});

describe("listWithBalances / assertCanAdd", () => {
  it.each<[Plan | null, number]>([
    [null, 3],
    ["CLASSIC", 5],
    ["PREMIUM", 10],
  ])("applies the limit of the plan %s: %i", async (plan, limit) => {
    const { listWithBalances, assertCanAdd } = harness({ names: ["Main", "Test"], plan });

    expect(await listWithBalances(USER)).toMatchObject({ count: 2, limit, status: "fresh" });
    expect(await assertCanAdd(USER)).toEqual({ ok: true });
  });

  it("blocks at the limit, and keeps the extra wallets of a downgraded user", async () => {
    const { listWithBalances, assertCanAdd } = harness({ names: ["1", "2", "3", "4", "5"] });

    expect(await listWithBalances(USER)).toMatchObject({ count: 5, limit: 3 });
    expect((await listWithBalances(USER)).wallets).toHaveLength(5);
    expect(await assertCanAdd(USER)).toEqual({ ok: false, reason: "limit_reached" });
  });

  it("passes a Refresh on to the balance service", async () => {
    const { listWithBalances, balances } = harness();

    await listWithBalances(USER, { skipCache: true });

    expect(balances.getUserBalances).toHaveBeenCalledWith(USER, { skipCache: true });
  });
});

describe("getOwned", () => {
  it("finds a wallet of the user with its balance", async () => {
    const { getOwned } = harness({ names: ["Main", "Test"] });

    expect(await getOwned(USER, "w2")).toMatchObject({
      wallet: { id: "w2", name: "Test", lamports: 1_000_000n },
      status: "fresh",
    });
  });

  it("gives null for an unknown id and for the wallet of someone else", async () => {
    const { getOwned, balances } = harness({ names: ["Main"] });

    expect(await getOwned(USER, "w9")).toBeNull();
    expect(await getOwned("u2", "w1")).toBeNull();
    expect(balances.getUserBalances).toHaveBeenLastCalledWith("u2", undefined);
  });
});

describe("create", () => {
  it("stores a CREATED wallet with its key and its phrase encrypted, and nothing in clear", async () => {
    const { create, rows, secretKeys, balances, generateWallet } = harness({
      names: ["Main", "Test"],
    });

    const result = await create(USER);

    expect(result).toEqual({
      ok: true,
      wallet: { id: "w3", name: "Wallet 3", publicKey: ADDRESS, createdAt: T0 },
    });
    expect(rows[2]).toMatchObject({
      userId: USER,
      source: "CREATED",
      derivationPath: "m/44'/501'/0'/0'",
      encSecretKey: bytes(`key:64:${ADDRESS}`),
      iv: bytes("iv"),
      authTag: bytes("tag"),
      encMnemonic: bytes(`mnemonic:${MNEMONIC}:${ADDRESS}`),
      mnemonicIv: bytes("miv"),
      mnemonicAuthTag: bytes("mtag"),
    });
    expect(JSON.stringify(result)).not.toContain("abandon");
    expect(secretKeys[0]?.every((byte) => byte === 0)).toBe(true);
    expect(balances.invalidateUserBalances).toHaveBeenCalledWith(USER);
    expect(generateWallet).toHaveBeenCalledOnce();
  });

  it("creates nothing at the limit, without generating a key", async () => {
    const { create, prisma, generateWallet, balances } = harness({ names: ["1", "2", "3"] });

    expect(await create(USER)).toEqual({ ok: false, reason: "limit_reached" });
    expect(generateWallet).not.toHaveBeenCalled();
    expect(prisma.wallet.create).not.toHaveBeenCalled();
    expect(balances.invalidateUserBalances).not.toHaveBeenCalled();
  });

  it("checks the limit again inside the lock: two clicks at limit − 1 create one wallet", async () => {
    const { create, rows, prisma } = harness({ names: ["1", "2"] });

    const results = await Promise.all([create(USER), create(USER)]);

    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
    expect(rows).toHaveLength(3);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it("retries with the next name when the default name was just taken", async () => {
    const { create, rows, prisma } = harness({
      names: ["Main"],
      failCreates: [uniqueViolation(["userId", "name"])],
    });

    const result = await create(USER);

    expect(result).toMatchObject({ ok: true, wallet: { name: "Wallet 2" } });
    expect(prisma.wallet.create).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });

  it.each([
    ["a unique violation on another constraint", uniqueViolation(["userId", "publicKey"])],
    ["any other error", new Error("connection lost")],
  ])("rethrows %s, and still zeroes the key", async (_label, failure) => {
    const { create, secretKeys } = harness({ failCreates: [failure] });

    await expect(create(USER)).rejects.toBe(failure);
    expect(secretKeys[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it("gives up after three name collisions", async () => {
    const collisions = Array.from({ length: 3 }, () => uniqueViolation(["userId", "name"]));
    const { create } = harness({ failCreates: collisions });

    await expect(create(USER)).rejects.toBe(collisions[2]);
  });
});

describe("rename", () => {
  it("normalizes the name, writes it and invalidates the balances", async () => {
    const { rename, rows, balances } = harness({ names: ["Main", "Test"] });

    const result = await rename(USER, "w1", "  My   main  ");

    expect(result).toMatchObject({ ok: true, wallet: { id: "w1", name: "My main" } });
    expect(rows[0]?.name).toBe("My main");
    expect(balances.invalidateUserBalances).toHaveBeenCalledWith(USER);
  });

  it.each([
    ["an empty name", "   ", { reason: "empty" }],
    ["33 characters", "a".repeat(33), { reason: "too_long", length: 33 }],
    ["a line break", "Main\nwallet", { reason: "invalid" }],
    [
      "the name of another wallet, whatever the case",
      "tEST",
      { reason: "duplicate", name: "Test" },
    ],
  ])("refuses %s without writing, with the wallet as it is", async (_label, name, issue) => {
    const { rename, prisma } = harness({ names: ["Main", "Test"] });

    expect(await rename(USER, "w1", name)).toEqual({
      ok: false,
      issue,
      wallet: { id: "w1", name: "Main", publicKey: "pk-1", createdAt: T0 },
    });
    expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
  });

  it("accepts 32 characters, emojis counted as one", async () => {
    const { rename } = harness({ names: ["Main"] });

    expect(await rename(USER, "w1", "🚀".repeat(32))).toMatchObject({ ok: true });
  });

  it("writes nothing for the same name, and says it went fine", async () => {
    const { rename, prisma, balances } = harness({ names: ["Main"] });

    expect(await rename(USER, "w1", " Main ")).toMatchObject({
      ok: true,
      wallet: { name: "Main" },
    });
    expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
    expect(balances.invalidateUserBalances).not.toHaveBeenCalled();
  });

  it("reports a duplicate when the constraint catches a rename that raced this one", async () => {
    const { rename } = harness({
      names: ["Main"],
      failUpdates: [uniqueViolation(["userId", "name"])],
    });

    expect(await rename(USER, "w1", "Test")).toMatchObject({
      ok: false,
      issue: { reason: "duplicate", name: "Test" },
      wallet: { name: "Main" },
    });
  });

  it("finds no wallet for another user, or for a wallet deleted meanwhile", async () => {
    const { rename, rows } = harness({ names: ["Main"] });
    const gone = harness({ names: ["Main"] });

    expect(await rename("u2", "w1", "Mine")).toEqual({ ok: false, issue: { reason: "not_found" } });
    expect(rows[0]?.name).toBe("Main");
    gone.prisma.wallet.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await gone.rename(USER, "w1", "Later")).toEqual({
      ok: false,
      issue: { reason: "not_found" },
    });
  });
});

describe("checkDeletable / delete", () => {
  it("reads the balance without the cache, and confirms at the fee budget exactly", async () => {
    const { checkDeletable, balances } = harness({ names: ["Main"], lamports: FEE_BUDGET });

    const check = await checkDeletable(USER, "w1");

    expect(check).toMatchObject({
      status: "confirm",
      detail: { wallet: { id: "w1" }, status: "fresh" },
    });
    expect(balances.getUserBalances).toHaveBeenCalledWith(USER, { skipCache: true });
  });

  it("blocks one lamport above the fee budget, with the balance to withdraw", async () => {
    const { checkDeletable } = harness({ names: ["Main"], lamports: FEE_BUDGET + 1n });

    expect(await checkDeletable(USER, "w1")).toMatchObject({
      status: "blocked_balance",
      lamports: FEE_BUDGET + 1n,
    });
  });

  it.each(["unavailable", "stale"] as const)(
    "refuses to decide on a balance that is %s",
    async (balancesStatus) => {
      const {
        checkDeletable,
        delete: remove,
        rows,
      } = harness({
        names: ["Main"],
        balancesStatus,
      });

      expect(await checkDeletable(USER, "w1")).toMatchObject({ status: "balance_unavailable" });
      expect(await remove(USER, "w1")).toMatchObject({ status: "balance_unavailable" });
      expect(rows).toHaveLength(1);
    },
  );

  it("blocks while a withdrawal from the wallet is pending", async () => {
    const { checkDeletable, prisma } = harness({ names: ["Main"], pendingWithdrawals: 1 });

    expect(await checkDeletable(USER, "w1")).toMatchObject({
      status: "blocked_pending_withdrawal",
    });
    expect(prisma.withdrawal.count).toHaveBeenCalledWith({
      where: { walletId: "w1", status: "PENDING" },
    });
  });

  it("deletes the row of the user only, and invalidates the balances", async () => {
    const {
      delete: remove,
      rows,
      prisma,
      balances,
    } = harness({
      names: ["Main", "Test"],
      lamports: 0n,
    });

    expect(await remove(USER, "w1")).toEqual({ status: "deleted" });
    expect(rows.map((row) => row.id)).toEqual(["w2"]);
    expect(prisma.wallet.deleteMany).toHaveBeenCalledWith({ where: { id: "w1", userId: USER } });
    expect(balances.invalidateUserBalances).toHaveBeenCalledWith(USER);
  });

  it("finds nothing the second time, and nothing of another user", async () => {
    const { delete: remove, prisma } = harness({ names: ["Main"], lamports: 0n });

    expect(await remove("u2", "w1")).toEqual({ status: "not_found" });
    expect(await remove(USER, "w1")).toEqual({ status: "deleted" });
    expect(await remove(USER, "w1")).toEqual({ status: "not_found" });
    expect(prisma.wallet.deleteMany).toHaveBeenCalledOnce();
  });
});
