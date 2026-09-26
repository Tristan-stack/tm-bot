import { randomBytes } from "node:crypto";
import {
  createKeyVault,
  generateMnemonicWallet,
  parsePrivateKey,
  parseSeedPhrase,
  revealWalletSecrets,
} from "@launchbot/solana";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { INVALID_PHRASES, TWELVE_WORDS, TWELVE_WORDS_ADDRESS } from "@launchbot/solana/test";
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
        parseSecret: { KEY: parsePrivateKey, SEED: parseSeedPhrase },
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

  // The vectors come from the wallet package (V1-09): Phantom shows TWELVE_WORDS_ADDRESS for the
  // first account of TWELVE_WORDS.
  describe("import", () => {
    /** A real base58 key of 64 bytes: the one a wallet of another account was created with. */
    const someonesKey = async () => {
      const other = await createUser();
      const created = await service().create(other.id);
      if (!created.ok) throw new Error(created.reason);
      const row = await prisma.wallet.findUniqueOrThrow({ where: { id: created.wallet.id } });
      return { ...revealWalletSecrets(row, vault), address: row.publicKey };
    };

    it("stores a key import under its own address, with no phrase", async () => {
      const [user, key] = await Promise.all([createUser(), someonesKey()]);

      const result = await service().importWallet(user.id, "KEY", ` ${key.privateKeyBase58} `);

      if (!result.ok) throw new Error(result.reason);
      // Two users may hold the same key (§13): the address is the one of the other account.
      expect(result.wallet).toMatchObject({ name: "Wallet 1", publicKey: key.address });
      const row = await prisma.wallet.findUniqueOrThrow({ where: { id: result.wallet.id } });
      expect(row).toMatchObject({
        source: "IMPORTED_KEY",
        derivationPath: null,
        encMnemonic: null,
        mnemonicIv: null,
        mnemonicAuthTag: null,
      });
      // The vault gives the key back to /getall (V1-43), and only to it.
      expect(revealWalletSecrets(row, vault)).toEqual({
        privateKeyBase58: key.privateKeyBase58,
        mnemonic: null,
      });
    });

    it("derives the Phantom address of a phrase and stores it normalized", async () => {
      const user = await createUser();

      const result = await service().importWallet(
        user.id,
        "SEED",
        `  ${TWELVE_WORDS.toUpperCase().replace(/ /g, "   ")}  `,
      );

      if (!result.ok) throw new Error(result.reason);
      expect(result.wallet.publicKey).toBe(TWELVE_WORDS_ADDRESS);
      const row = await prisma.wallet.findUniqueOrThrow({ where: { id: result.wallet.id } });
      expect(row).toMatchObject({ source: "IMPORTED_SEED", derivationPath: "m/44'/501'/0'/0'" });
      expect(revealWalletSecrets(row, vault).mnemonic).toBe(TWELVE_WORDS);
    });

    it("keeps no plain secret in the row", async () => {
      const user = await createUser();
      const result = await service().importWallet(user.id, "SEED", TWELVE_WORDS);

      if (!result.ok) throw new Error(result.reason);
      const row = await prisma.wallet.findUniqueOrThrow({ where: { id: result.wallet.id } });
      // Every column as text, ciphertext included: no byte of the phrase is readable.
      const dump = Object.values(row)
        .map((value) =>
          value instanceof Uint8Array ? Buffer.from(value).toString("latin1") : String(value),
        )
        .join("|");
      expect(dump).not.toContain("abandon");
      expect(dump).not.toContain("about");
    });

    it("logs nothing of the secret, valid or not", async () => {
      const user = await createUser();
      const lines = captureLogs();
      try {
        const wallets = service();
        await wallets.importWallet(user.id, "SEED", TWELVE_WORDS);
        await wallets.importWallet(user.id, "SEED", INVALID_PHRASES.wrongChecksum);
        await wallets.importWallet(user.id, "KEY", "not a private key");
      } finally {
        setLogDestination(undefined);
      }

      expect(lines.join("")).not.toContain("abandon");
    });

    it.each([
      ["KEY" as const, "not a private key"],
      ["KEY" as const, `[${Array.from({ length: 64 }, () => 1).join(",")}]`],
      ["SEED" as const, INVALID_PHRASES.wrongChecksum],
      ["SEED" as const, INVALID_PHRASES.thirteenWords],
    ])("refuses a %s that does not parse: %s", async (format, secret) => {
      const user = await createUser();

      expect(await service().importWallet(user.id, format, secret)).toEqual({
        ok: false,
        reason: "invalid_secret",
      });
      expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(0);
    });

    it("imports a phrase once, then reports a duplicate, twice concurrently included", async () => {
      const [user, other] = await Promise.all([createUser(), createUser()]);
      const wallets = service();

      const results = await Promise.all([
        wallets.importWallet(user.id, "SEED", TWELVE_WORDS),
        wallets.importWallet(user.id, "SEED", TWELVE_WORDS),
      ]);

      expect(results.map((result) => (result.ok ? "ok" : result.reason)).sort()).toEqual([
        "duplicate",
        "ok",
      ]);
      expect(await prisma.wallet.count({ where: { userId: user.id } })).toBe(1);
      // The same phrase in another account is another wallet, not a duplicate.
      expect(await wallets.importWallet(other.id, "SEED", TWELVE_WORDS)).toMatchObject({
        ok: true,
      });
    });

    it("stops at the limit of the plan, without the wallets of the other users", async () => {
      const user = await createUser();
      await prisma.wallet.createMany({
        data: [1, 2, 3].map((n) => testWalletData(user.id, `Wallet ${n}`, `${user.id}-${n}`)),
      });

      expect(await service().importWallet(user.id, "SEED", TWELVE_WORDS)).toEqual({
        ok: false,
        reason: "limit_reached",
      });
    });
  });

  it("leaves a launch wallet out of the list, the limit, the names, Rename and Delete", async () => {
    const user = await createUser();
    const wallets = service();
    for (const name of ["Wallet 1", "Wallet 2"]) {
      await wallets.create(user.id);
      expect((await wallets.listWithBalances(user.id)).wallets.at(-1)?.name).toBe(name);
    }
    const hidden = await prisma.wallet.create({
      data: {
        ...testWalletData(user.id, "Launch $OTTR · 8oHs3P", generateMnemonicWallet().address),
        kind: "LAUNCH",
      },
    });

    // No plan: 3 wallets. The third one is created, and named after the two the user sees.
    const third = await wallets.create(user.id);
    expect(third).toMatchObject({ ok: true, wallet: { name: "Wallet 3" } });
    expect((await wallets.listWithBalances(user.id)).count).toBe(3);
    expect(await wallets.getQuota(user.id)).toMatchObject({ count: 3, reached: true });
    expect(await wallets.getOwned(user.id, hidden.id)).toBeNull();
    expect(await wallets.rename(user.id, hidden.id, "Mine")).toEqual({
      ok: false,
      issue: { reason: "not_found" },
    });
    expect(await wallets.delete(user.id, hidden.id)).toEqual({ status: "not_found" });
    expect(await prisma.wallet.findUnique({ where: { id: hidden.id } })).toMatchObject({
      name: "Launch $OTTR · 8oHs3P",
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
