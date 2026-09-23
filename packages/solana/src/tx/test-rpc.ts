import { randomBytes } from "node:crypto";
import { LAMPORTS_PER_SOL } from "@launchbot/shared";
import { Keypair } from "@solana/web3.js";
import type { VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { generateKeypair } from "../keys/keypair.js";
import { createKeyVault } from "../keys/vault.js";
import type { KeyVault, SolanaSigner, StoredSecret } from "../keys/vault.js";
import type { PriorityFeeBounds, SignerSource, TxContext, TxRpc } from "./types.js";

/**
 * A `Connection` that answers from a script, for the tests of `tx/`. It lives beside the code
 * it fakes, like `keys/test-vectors.ts`: one harness, so that every test of the sender says
 * what it changed and nothing else. Every call is recorded in order, `withSigner` included,
 * which is how a test asserts that no key was decrypted before the simulation.
 */
export type RpcCall = { method: string } & Record<string, unknown>;

export type FakeStatus = {
  slot?: number;
  err?: unknown;
  confirmationStatus?: "processed" | "confirmed" | "finalized";
};

export type FakeRpcState = {
  /** Lamports by address. An address that is absent has no account at all. */
  balances: Record<string, bigint>;
  rentMin: number;
  /** What `getRecentPrioritizationFees` answers, in microlamports per compute unit. */
  fees: number[];
  unitsConsumed: number | undefined;
  simulationError: unknown;
  simulationLogs: string[];
  /** One per `getLatestBlockhash`, the last one repeating: a second attempt gets a fresh one. */
  blockhashes: string[];
  lastValidBlockHeight: number;
  /** One per `getBlockHeight`, the last one repeating. */
  heights: number[];
  /** One per `getSignatureStatuses`, the last one repeating; an empty list means not found. */
  statuses: (FakeStatus | null)[];
  /** The answer of the call made with `searchTransactionHistory`. */
  historyStatus: FakeStatus | null;
  /** One per `sendRawTransaction`: an error rejects, `null` succeeds. */
  sendThrows: (Error | null)[];
  /** Rejected by the method of that name, on every call. */
  throws: Partial<Record<string, Error>>;
  /** Runs before every answer: a test changes the script in the middle of a flow. */
  onCall?: (method: string) => void;
};

/** `getMinimumBalanceForRentExemption(0)` on devnet. */
export const DEVNET_RENT_MIN = 890_880n;

/** 0.001 SOL, the amount of the devnet test. */
export const milliSol = LAMPORTS_PER_SOL / 1000n;

/** The bounds of §12 as the dev `.env` proposes them. */
export const TEST_BOUNDS: PriorityFeeBounds = { minMicroLamports: 0, maxMicroLamports: 1_000_000 };

/** A fresh address: nothing is ever sent to it. */
export const address = (): string => Keypair.generate().publicKey.toBase58();

/** A fresh set for every fake: the queues are consumed in place, one test never feeds another. */
const defaults = (): FakeRpcState => ({
  balances: {},
  rentMin: Number(DEVNET_RENT_MIN),
  fees: [],
  unitsConsumed: 450,
  simulationError: null,
  simulationLogs: [],
  blockhashes: [
    "4o1TsYfUB5xGn1UYPgVuqsB1iSZihpH67YeVFEJufWjg",
    "BVJsKgyzERkJ6Y5H8vnFpMw39gTcQy2ngDyRj78Nnvdv",
  ],
  lastValidBlockHeight: 200,
  heights: [],
  statuses: [],
  historyStatus: null,
  sendThrows: [],
  throws: {},
});

/** The scripted value of a queue: each call shifts one, the last one answers forever. */
const nextOf = <T>(queue: T[]): T | undefined => (queue.length > 1 ? queue.shift() : queue[0]);

export type FakeRpc = {
  rpc: TxRpc;
  /** Every call, in order, with what the test needs of its arguments. */
  calls: RpcCall[];
  /** The calls of one method. */
  of: (method: string) => RpcCall[];
  /** The methods called, in order. */
  methods: () => string[];
  /** Mutable: a test changes an answer between two calls. */
  state: FakeRpcState;
  /** The transactions handed to `sendRawTransaction`, as raw bytes. */
  sent: Uint8Array[];
  /** The transactions handed to `simulateTransaction`. */
  simulated: VersionedTransaction[];
};

export function fakeRpc(options: Partial<FakeRpcState> = {}, calls: RpcCall[] = []): FakeRpc {
  const state: FakeRpcState = { ...defaults(), ...options };
  const sent: Uint8Array[] = [];
  const simulated: VersionedTransaction[] = [];

  /** Records the call, then answers as a `Connection` would: always asynchronously. */
  const answer = <T>(method: string, rest: Record<string, unknown>, value: () => T): Promise<T> => {
    state.onCall?.(method);
    calls.push({ method, ...rest });
    const thrown = state.throws[method];
    return thrown === undefined
      ? new Promise<T>((resolve) => resolve(value()))
      : Promise.reject(thrown);
  };

  const statusOf = (status: FakeStatus | null | undefined) =>
    status === null || status === undefined
      ? null
      : {
          slot: status.slot ?? 42,
          confirmations: null,
          err: status.err ?? null,
          confirmationStatus: status.confirmationStatus ?? "confirmed",
        };

  const rpc = {
    getRecentPrioritizationFees: (config?: { lockedWritableAccounts?: { toBase58(): string }[] }) =>
      answer(
        "getRecentPrioritizationFees",
        { accounts: (config?.lockedWritableAccounts ?? []).map((key) => key.toBase58()) },
        () =>
          state.fees.map((prioritizationFee, index) => ({ slot: 1000 + index, prioritizationFee })),
      ),

    simulateTransaction: (transaction: VersionedTransaction) =>
      answer("simulateTransaction", {}, () => {
        simulated.push(transaction);
        return {
          context: { slot: 1 },
          value: {
            err: state.simulationError,
            logs: state.simulationLogs,
            unitsConsumed: state.unitsConsumed,
            accounts: null,
          },
        };
      }),

    getMinimumBalanceForRentExemption: (size: number) =>
      answer("getMinimumBalanceForRentExemption", { size }, () => state.rentMin),

    getMultipleAccountsInfo: (keys: { toBase58(): string }[]) => {
      const addresses = keys.map((key) => key.toBase58());
      return answer("getMultipleAccountsInfo", { addresses }, () =>
        addresses.map((account) => {
          const lamports = state.balances[account];
          return lamports === undefined ? null : { lamports: Number(lamports) };
        }),
      );
    },

    getLatestBlockhash: () =>
      answer("getLatestBlockhash", {}, () => ({
        blockhash: nextOf(state.blockhashes) ?? "",
        lastValidBlockHeight: state.lastValidBlockHeight,
      })),

    sendRawTransaction: (raw: Uint8Array) =>
      answer("sendRawTransaction", {}, () => {
        sent.push(Uint8Array.from(raw));
        const thrown = state.sendThrows.shift();
        if (thrown !== undefined && thrown !== null) throw thrown;
        return "signature";
      }),

    getSignatureStatuses: (
      signatures: string[],
      config?: { searchTransactionHistory?: boolean },
    ) => {
      const history = config?.searchTransactionHistory === true;
      return answer("getSignatureStatuses", { history }, () => ({
        context: { slot: 1 },
        value: [statusOf(history ? state.historyStatus : nextOf(state.statuses))],
      }));
    },

    getBlockHeight: () =>
      answer("getBlockHeight", {}, () => nextOf(state.heights) ?? state.lastValidBlockHeight),
  };

  return {
    rpc: rpc as unknown as TxRpc,
    calls,
    of: (method) => calls.filter((call) => call.method === method),
    methods: () => calls.map((call) => call.method),
    state,
    sent,
    simulated,
  };
}

/** The context of a fake, with a pause that returns at once. */
export const testContext = (
  fake: FakeRpc,
  priorityFee: PriorityFeeBounds = TEST_BOUNDS,
): TxContext => ({
  rpc: fake.rpc,
  priorityFee,
  wait: () => Promise.resolve(),
});

/** The same vault, recording every decryption in the call log of a fake RPC. */
export function spyVault(vault: KeyVault, calls: RpcCall[]): KeyVault {
  return {
    encrypt: (secretKey, address) => vault.encrypt(secretKey, address),
    encryptMnemonic: (mnemonic, address) => vault.encryptMnemonic(mnemonic, address),
    withSigner: <T>(
      enc: StoredSecret,
      address: string,
      fn: (signer: SolanaSigner) => Promise<T>,
    ): Promise<T> => {
      calls.push({ method: "withSigner", address });
      return vault.withSigner(enc, address, fn);
    },
  };
}

/**
 * A wallet whose key a fresh vault holds, ready to sign. With `calls`, every decryption lands in
 * that log. The base58 of the key is the oracle of the « no leak » test, nothing else.
 */
export function vaultSigner(calls?: RpcCall[]): {
  address: string;
  signer: SignerSource;
  secretKeyBase58: string;
} {
  const vault = createKeyVault(randomBytes(32));
  const wallet = generateKeypair();
  const secretKeyBase58 = bs58.encode(wallet.secretKey);
  const enc = vault.encrypt(wallet.secretKey, wallet.address);
  wallet.secretKey.dispose();
  return {
    address: wallet.address,
    secretKeyBase58,
    signer: {
      kind: "vault",
      vault: calls === undefined ? vault : spyVault(vault, calls),
      enc,
      address: wallet.address,
    },
  };
}

const view = (data: Uint8Array): DataView =>
  new DataView(data.buffer, data.byteOffset, data.byteLength);

const instructionAt = (transaction: VersionedTransaction, index: number): Uint8Array => {
  const data = transaction.message.compiledInstructions[index]?.data;
  if (data === undefined) throw new Error(`No instruction ${index}`);
  return data;
};

/** What the two Compute Budget instructions of a built transaction ask for. */
export const budgetOf = (
  transaction: VersionedTransaction,
): { computeUnitLimit: number; microLamportsPerCu: bigint } => ({
  computeUnitLimit: view(instructionAt(transaction, 0)).getUint32(1, true),
  microLamportsPerCu: view(instructionAt(transaction, 1)).getBigUint64(1, true),
});

/** The lamports of the `SystemProgram.transfer` that follows them. */
export const transferredLamports = (transaction: VersionedTransaction): bigint =>
  view(instructionAt(transaction, 2)).getBigUint64(4, true);
