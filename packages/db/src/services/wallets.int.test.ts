import { randomBytes } from "node:crypto";
import {
  createKeyVault,
  generateMnemonicWallet,
  parsePrivateKey,
  parseSeedPhrase,
  revealWalletSecrets,
} from "@launchbot/solana";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../client.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTestUser, resetTestDatabase, testWalletData } from "../test-db.js";
import { createBalancesService } from "./balances.js";
import { createWalletService } from "./wallets.js";

// Needs PostgreSQL (`pnpm db:up`), in a database of its own: suites run in parallel.
describe.skipIf(!process.env["RUN_DB_TESTS"])("wallet service (db)", () => {
  let prisma: PrismaClient;
  const vault = createKeyVault(randomBytes(32));
  const createUser = () => createTestUser(prisma);

  beforeAll(async () => {
    prisma = createPrismaClient(await resetTestDatabase("wallets"));
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.wallet.deleteMany();
  });

  /** The RPC, faked: every address holds `lamports`, or the read fails. */
  function service(lamports: bigint | Error = 0n) {
    const readLamports = vi.fn((addresses: string[]) =>
      lamports instanceof Error
        ? Promise.reject(lamports)
        : Promise.resolve(new Map(addresses.map((address) => [address, lamports]))),
    );
    const balances = createBalancesService({ prisma, readLamports });
    return {
      ...createWalletService({
        prisma,
        balances,
        generateWallet: generateMnemonicWallet,
        vault,
        withdrawFeeBudgetLamports: 6_000n,
      }),
      readLamports,
    };
  }

  it("stores a wallet the vault can give back to /getall: key and 12-word phrase", async () => {
    const user = await createUser();

    const result = await service().create(user.id);

    if (!result.ok) throw new Error(result.reason);
    const row = await prisma.wallet.findUniqueOrThrow({ where: { id: result.wallet.id } });
    expect(row).toMatchObject({
      userId: user.id,
      name: "Wallet 1",
      source: "CREATED",
      derivationPath: "m/44'/501'/0'/0'",
    });
    const secrets = revealWalletSecrets(row, vault);
    // The two formats a user imports elsewhere give back the address of the row.
    expect(parsePrivateKey(secrets.privateKeyBase58)).toMatchObject({
      ok: true,
      address: row.publicKey,
    });
    expect(secrets.mnemonic?.split(" ")).toHaveLength(12);
    expect(parseSeedPhrase(secrets.mnemonic ?? "")).toMatchObject({
      ok: true,
      address: row.publicKey,
    });
  });

  it("creates one wallet for two concurrent clicks at limit − 1", async () => {
    const user = await createUser();
    await prisma.wallet.createMany({
      data: [1, 2].map((n) => testWalletData(user.id, `Wallet ${n}`, `${user.id}-${n}`)),
    });
    const wallets = service();

    const results = await Promise.all([wallets.create(user.id), wallets.create(user.id)]);

    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
    expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(3);
    expect(await wallets.listWithBalances(user.id)).toMatchObject({ count: 3, limit: 3 });
  });

  it("shows the new wallet at once, and never the wallet of another user", async () => {
    const [owner, other] = await Promise.all([createUser(), createUser()]);
    const wallets = service();
    await wallets.listWithBalances(owner.id);

    const result = await wallets.create(owner.id);

    if (!result.ok) throw new Error(result.reason);
    const list = await wallets.listWithBalances(owner.id);
    expect(list.wallets.map((wallet) => wallet.id)).toEqual([result.wallet.id]);
    expect(await wallets.getOwned(owner.id, result.wallet.id)).toMatchObject({
      wallet: { name: "Wallet 1", lamports: 0n },
    });
    expect(await wallets.getOwned(other.id, result.wallet.id)).toBeNull();
  });

  describe("delete", () => {
    const walletOf = async (userId: string) => {
      const created = await service().create(userId);
      if (!created.ok) throw new Error(created.reason);
      return created.wallet;
    };

    it("is blocked above the fee budget, refused on an RPC error, and blocked by a deposit that arrives late", async () => {
      const user = await createUser();
      const wallet = await walletOf(user.id);

      expect(await service(6_001n).checkDeletable(user.id, wallet.id)).toMatchObject({
        status: "blocked_balance",
        lamports: 6_001n,
      });
      expect(await service(new Error("rpc down")).delete(user.id, wallet.id)).toMatchObject({
        status: "balance_unavailable",
      });
      // Confirmed on an empty wallet, then SOL arrived before "Yes, delete".
      expect(await service(0n).checkDeletable(user.id, wallet.id)).toMatchObject({
        status: "confirm",
      });
      expect(await service(1_000_000n).delete(user.id, wallet.id)).toMatchObject({
        status: "blocked_balance",
      });
      expect(await prisma.wallet.count({ where: { id: wallet.id } })).toBe(1);
    });

    it("erases the row and its key, keeps the withdrawal history, and leaves other users alone", async () => {
      const [user, other] = await Promise.all([createUser(), createUser()]);
      const [wallet, theirs] = await Promise.all([walletOf(user.id), walletOf(other.id)]);
      const withdrawal = await prisma.withdrawal.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          fromAddress: wallet.publicKey,
          toAddress: theirs.publicKey,
          lamports: 1n,
          status: "CONFIRMED",
        },
      });
      const wallets = service();
      await wallets.listWithBalances(user.id);

      expect(await wallets.delete(user.id, wallet.id)).toEqual({ status: "deleted" });

      expect(await prisma.wallet.findUnique({ where: { id: wallet.id } })).toBeNull();
      expect(
        await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } }),
      ).toMatchObject({ walletId: null, fromAddress: wallet.publicKey });
      expect(await prisma.wallet.count({ where: { userId: other.id } })).toBe(1);
      expect((await wallets.listWithBalances(user.id)).wallets).toEqual([]);
      expect(await wallets.delete(user.id, wallet.id)).toEqual({ status: "not_found" });
    });

    it("waits for a pending withdrawal", async () => {
      const user = await createUser();
      const wallet = await walletOf(user.id);
      await prisma.withdrawal.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          fromAddress: wallet.publicKey,
          toAddress: wallet.publicKey,
          lamports: 1n,
        },
      });

      expect(await service().delete(user.id, wallet.id)).toMatchObject({
        status: "blocked_pending_withdrawal",
      });
    });
  });
});
