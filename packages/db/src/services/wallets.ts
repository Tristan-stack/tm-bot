import {
  getWalletLimit,
  IMPORT_SECRET_MAX_CHARS,
  isBalanceWithdrawable,
  normalizeWalletName,
  walletNameIssue,
} from "@launchbot/shared";
import type { ImportFormat, WalletNameIssue } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type {
  EncryptedMnemonic,
  EncryptedSecret,
  ImportResult,
  KeyVault,
  MnemonicWallet,
} from "@launchbot/solana";
import type { Db } from "../client.js";
import { isUniqueViolation } from "../errors.js";
import type { PrismaClient, WalletSource } from "../generated/prisma/client.js";
import { readFreshWallet, WALLET_SUMMARY_SELECT } from "./balances.js";
import type { BalancesService, UserBalances, WalletBalance, WalletDetailData } from "./balances.js";

export type { WalletDetailData } from "./balances.js";
import { getActiveSubscription, getWalletQuota } from "./subscriptions.js";
import type { WalletQuota } from "./subscriptions.js";

const log = createLogger("db:wallets");

/** A wallet as the screens show it: never a key column (§9.6). */
export type WalletSummary = Omit<WalletBalance, "lamports">;

/** The list screen (§9.1): the balances of V1-07 and the quota of the plan (§8.1). */
export type WalletListData = UserBalances & {
  count: number;
  /** `count` can exceed it: wallets are kept after an expiry or a downgrade (§8.1). */
  limit: number;
};

/** A wallet added to the list, or the reason it was not: one shape, three reason sets. */
type AddResult<Reason extends string> =
  { ok: true; wallet: WalletSummary } | { ok: false; reason: Reason };

export type CreateWalletResult = AddResult<"limit_reached">;
/** What the locked insertion can answer, whatever brought the key. */
type InsertResult = AddResult<"limit_reached" | "duplicate">;
/** `invalid_secret`: the caller knows the format, so it knows which text the user reads (§9.4). */
export type WalletImportResult = AddResult<"invalid_secret" | "limit_reached" | "duplicate">;

export type RenameIssue = WalletNameIssue | { reason: "duplicate"; name: string };
export type RenameResult =
  | { ok: true; wallet: WalletSummary }
  | { ok: false; issue: { reason: "not_found" } }
  /** With the wallet as it is: the input screen shows it again without another read. */
  | { ok: false; issue: RenameIssue; wallet: WalletSummary };

/** What a click on Delete, then on "Yes, delete", finds (§9.3), with the detail to show. */
export type DeleteCheck =
  | {
      status: "confirm" | "balance_unavailable" | "blocked_pending_withdrawal";
      detail: WalletDetailData;
    }
  | { status: "blocked_balance"; detail: WalletDetailData; lamports: bigint }
  | { status: "not_found" };
export type DeleteResult = DeleteCheck | { status: "deleted" };

// Type-only imports of @launchbot/solana: erased at runtime, so this package still does not
// load it (the vault and the generator are injected).
export type GeneratedWallet = MnemonicWallet;
/** The two encrypting methods of the vault: nothing decrypts here. */
export type WalletVault = Pick<KeyVault, "encrypt" | "encryptMnemonic">;
/** `parsePrivateKey` and `parseSeedPhrase` of the wallet package, by format (§9.4). */
export type SecretParsers = Record<ImportFormat, (secret: string) => ImportResult>;

export type WalletsDeps = {
  prisma: PrismaClient;
  balances: Pick<BalancesService, "getUserBalances" | "invalidateUserBalances">;
  generateWallet: () => GeneratedWallet;
  parseSecret: SecretParsers;
  vault: WalletVault;
  /** `getWithdrawFeeBudgetLamports(env.PRIORITY_FEE_MAX_MICROLAMPORTS)`: the Delete threshold. */
  withdrawFeeBudgetLamports: bigint;
  now?: () => number;
};

export type WalletService = {
  /** The wallets of the user, oldest first, with their balances (cached 30 s, V1-07). */
  listWithBalances: (userId: string, options?: { skipCache?: boolean }) => Promise<WalletListData>;
  /** `null` for an id that is not a wallet of this user: a deleted one, or someone else's. */
  getOwned: (
    userId: string,
    walletId: string,
    options?: { skipCache?: boolean },
  ) => Promise<WalletDetailData | null>;
  /**
   * How many wallets the plan allows and how many are used (§8.1): the counter of the Import
   * screen, and the check Create makes before generating a key. Two cheap reads, no balance.
   */
  getQuota: (userId: string) => Promise<WalletQuota>;
  /** `Wallet N`, N from the number of wallets + 1, skipping the names already taken. */
  nextDefaultName: (userId: string) => Promise<string>;
  /**
   * A wallet from a 12-word phrase (decision of 16/09/2026), key and phrase stored encrypted,
   * nothing returned in clear. The limit is checked again inside a transaction under a lock
   * per user (proposal): two clicks at limit − 1 create one wallet.
   */
  create: (userId: string) => Promise<CreateWalletResult>;
  /**
   * A wallet from a key the user already owns (§9.4): the key, and the phrase of a `SEED`
   * import, are stored encrypted, nothing is returned in clear. The same address twice for one
   * user is a `duplicate`, whatever the format it came in; two users may hold the same key.
   */
  importWallet: (
    userId: string,
    format: ImportFormat,
    secret: string,
  ) => Promise<WalletImportResult>;
  /** Normalizes the name, refuses a duplicate (case-insensitive, proposal). Same name: no write. */
  rename: (userId: string, walletId: string, rawName: string) => Promise<RenameResult>;
  /** Reads the balance without the cache (a security check, outside the Refresh throttle). */
  checkDeletable: (userId: string, walletId: string) => Promise<DeleteCheck>;
  /** Checks again, then erases the row and its key (§9.3). Withdrawals keep their history. */
  delete: (userId: string, walletId: string) => Promise<DeleteResult>;
};

const LIMIT_REACHED = { ok: false, reason: "limit_reached" } as const;
const DUPLICATE = { ok: false, reason: "duplicate" } as const;
/** A name can only collide with a rename racing the lock: one retry is plenty, two is safe. */
const NAME_ATTEMPTS = 3;

const IMPORTED_SOURCE = {
  KEY: "IMPORTED_KEY",
  SEED: "IMPORTED_SEED",
} as const satisfies Record<ImportFormat, WalletSource>;

/** The key columns of a new row: the phrase is there for `CREATED` and `IMPORTED_SEED` only. */
type KeyColumns = {
  publicKey: string;
  source: WalletSource;
  derivationPath: string | null;
} & EncryptedSecret &
  Partial<EncryptedMnemonic>;

const defaultName = (n: number): string => `Wallet ${n}`;

/** The wallets of the user, as the insertion needs them: a name to pick, an address to refuse. */
type TakenWallet = { name: string; publicKey: string };
const walletsOf = (db: Db, userId: string): Promise<TakenWallet[]> =>
  db.wallet.findMany({ where: { userId }, select: { name: true, publicKey: true } });

function nextName(taken: TakenWallet[]): string {
  const names = new Set(taken.map((wallet) => wallet.name));
  let n = taken.length + 1;
  while (names.has(defaultName(n))) n++;
  return defaultName(n);
}

export function createWalletService(deps: WalletsDeps): WalletService {
  const {
    prisma,
    balances,
    generateWallet,
    parseSecret,
    vault,
    withdrawFeeBudgetLamports,
    now = Date.now,
  } = deps;
  const clock = () => new Date(now());

  const limitOf = async (db: Db, userId: string): Promise<number> =>
    getWalletLimit((await getActiveSubscription(db, userId, clock()))?.plan ?? null);

  async function listWithBalances(userId: string, options?: { skipCache?: boolean }) {
    const [read, limit] = await Promise.all([
      balances.getUserBalances(userId, options),
      limitOf(prisma, userId),
    ]);
    return { ...read, count: read.wallets.length, limit };
  }

  const getQuota = (userId: string) => getWalletQuota(prisma, userId, clock());

  /**
   * The insertion Create and Import share (§9.4): one advisory lock per user, the limit and the
   * address rechecked inside it, and the default name taken from the names already used. The
   * key is encrypted by the caller, before the lock: PBKDF2 must not hold a transaction open.
   */
  async function insertWallet(userId: string, columns: KeyColumns): Promise<InsertResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        const outcome = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${userId}`}))`;
          const taken = await walletsOf(tx, userId);
          if (taken.length >= (await limitOf(tx, userId))) return LIMIT_REACHED;
          // Per user (§13): the same key imported by someone else is another wallet.
          if (taken.some((wallet) => wallet.publicKey === columns.publicKey)) return DUPLICATE;
          const wallet = await tx.wallet.create({
            data: { userId, name: nextName(taken), ...columns },
            select: WALLET_SUMMARY_SELECT,
          });
          return { ok: true as const, wallet };
        });
        // The new wallet must show everywhere at once: home, list (§4.3).
        if (outcome.ok) balances.invalidateUserBalances(userId);
        return outcome;
      } catch (error) {
        // The unique constraints are the net under a click that raced this one.
        if (isUniqueViolation(error, ["userId", "publicKey"])) return DUPLICATE;
        if (attempt >= NAME_ATTEMPTS || !isUniqueViolation(error, ["userId", "name"])) throw error;
      }
    }
  }

  async function checkDeletable(userId: string, walletId: string): Promise<DeleteCheck> {
    const [fresh, pending] = await Promise.all([
      readFreshWallet(balances, userId, walletId),
      prisma.withdrawal.count({ where: { walletId, status: "PENDING" } }),
    ]);
    // Only a read of this very moment lets a key be erased.
    if (fresh.status !== "fresh") return fresh;
    const { detail, lamports } = fresh;
    if (pending > 0) return { status: "blocked_pending_withdrawal", detail };
    if (isBalanceWithdrawable(lamports, withdrawFeeBudgetLamports)) {
      return { status: "blocked_balance", detail, lamports };
    }
    return { status: "confirm", detail };
  }

  return {
    listWithBalances,
    getQuota,
    checkDeletable,

    async getOwned(userId, walletId, options) {
      // The rows come with the balances: an id of another user is simply not there.
      const { wallets, fetchedAt, status } = await balances.getUserBalances(userId, options);
      const wallet = wallets.find((candidate) => candidate.id === walletId);
      return wallet === undefined ? null : { wallet, fetchedAt, status };
    },

    nextDefaultName: async (userId) => nextName(await walletsOf(prisma, userId)),

    async create(userId) {
      // Outside the lock first: no key is generated for a user at the limit.
      if ((await getQuota(userId)).reached) return LIMIT_REACHED;

      // Generation and encryption (PBKDF2, tens of ms) happen before the lock is taken.
      const generated = generateWallet();
      try {
        const result = await insertWallet(userId, {
          publicKey: generated.address,
          source: "CREATED",
          derivationPath: generated.derivationPath,
          ...vault.encrypt(generated.secretKey, generated.address),
          ...vault.encryptMnemonic(generated.mnemonic, generated.address),
        });
        if (result.ok) return result;
        // An address out of the CSPRNG is new: a duplicate here is a bug, not a user error.
        if (result.reason === "duplicate") {
          throw new Error("The generated address is already stored for this user");
        }
        return LIMIT_REACHED;
      } finally {
        generated.secretKey.dispose();
      }
    },

    async importWallet(userId, format, secret) {
      // The order of §9.4: the format is judged first, so a bad paste never reads the quota.
      // A whole message pasted around a key is refused here rather than scanned.
      if (secret.length > IMPORT_SECRET_MAX_CHARS) return { ok: false, reason: "invalid_secret" };
      const parsed = parseSecret[format](secret);
      if (!parsed.ok) return { ok: false, reason: "invalid_secret" };
      try {
        // No quota pre-check: the key is already parsed, and the limit of the lock is the one
        // that decides. Create pre-checks because it would otherwise generate a key for nothing.
        const { address, secretKey, mnemonic, derivationPath } = parsed;
        return await insertWallet(userId, {
          publicKey: address,
          source: IMPORTED_SOURCE[format],
          derivationPath,
          ...vault.encrypt(secretKey, address),
          // Decision of 16/09/2026: an imported phrase is stored encrypted too, so that the
          // support can give it back (V1-43). A key import leaves the three columns null.
          ...(mnemonic === null ? {} : vault.encryptMnemonic(mnemonic, address)),
        });
      } finally {
        parsed.secretKey.dispose();
      }
    },

    async rename(userId, walletId, rawName) {
      const wallets = await prisma.wallet.findMany({
        where: { userId },
        select: WALLET_SUMMARY_SELECT,
      });
      const current = wallets.find((wallet) => wallet.id === walletId);
      if (current === undefined) return { ok: false, issue: { reason: "not_found" } };

      const issue = walletNameIssue(rawName);
      if (issue !== null) return { ok: false, issue, wallet: current };
      const name = normalizeWalletName(rawName);
      if (current.name === name) return { ok: true, wallet: current };
      const lower = name.toLowerCase();
      const taken = wallets.find(
        (wallet) => wallet.id !== walletId && wallet.name.toLowerCase() === lower,
      );
      if (taken !== undefined) {
        return { ok: false, issue: { reason: "duplicate", name: taken.name }, wallet: current };
      }

      try {
        // `updateMany` with the owner in the filter: a wallet deleted meanwhile updates nothing.
        const { count } = await prisma.wallet.updateMany({
          where: { id: walletId, userId },
          data: { name },
        });
        if (count === 0) return { ok: false, issue: { reason: "not_found" } };
      } catch (error) {
        // The unique constraint is the net under a rename that raced this one.
        if (!isUniqueViolation(error, ["userId", "name"])) throw error;
        return { ok: false, issue: { reason: "duplicate", name }, wallet: current };
      }
      // The name is a user input: not logged.
      log.info({ userId, walletId }, "wallet.renamed");
      balances.invalidateUserBalances(userId);
      return { ok: true, wallet: { ...current, name } };
    },

    async delete(userId, walletId) {
      // SOL can arrive between the confirmation screen and the click: checked again.
      const check = await checkDeletable(userId, walletId);
      if (check.status !== "confirm") return check;
      const { count } = await prisma.wallet.deleteMany({ where: { id: walletId, userId } });
      if (count === 0) return { status: "not_found" };
      log.info({ userId, walletId }, "wallet.deleted");
      balances.invalidateUserBalances(userId);
      return { status: "deleted" };
    },
  };
}
