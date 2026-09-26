import type {
  AddressLookupTableAccount,
  Connection,
  TransactionInstruction,
} from "@solana/web3.js";
import type { KeyVault, SolanaSigner, StoredSecret } from "../keys/vault.js";

/** Every amount here is in lamports, as the `Withdrawal` and `Payment` columns of V1-02. */
export type Lamports = bigint;

/**
 * The two bounds of §12, validated by V1-01 (`PRIORITY_FEE_MIN_MICROLAMPORTS`,
 * `PRIORITY_FEE_MAX_MICROLAMPORTS`). They are passed in: this package reads no environment.
 */
export type PriorityFeeBounds = { minMicroLamports: number; maxMicroLamports: number };

/** What sending a transaction needs of a `Connection`; a test passes the methods it uses. */
export type TxRpc = Pick<
  Connection,
  | "getRecentPrioritizationFees"
  | "simulateTransaction"
  | "getMinimumBalanceForRentExemption"
  | "getMultipleAccountsInfo"
  | "getLatestBlockhash"
  | "sendRawTransaction"
  | "getSignatureStatuses"
  | "getBlockHeight"
>;

/**
 * The connection and the fee bounds travel together: every entry point of `tx/` needs both,
 * and the bot builds one context at startup beside its `KeyVault`.
 */
export type TxContext = {
  /**
   * The connection of the process (`getSolanaRpc`), always the same object: the rent-exempt
   * cache is keyed by it, and a wrapper built per request would read the chain every time.
   */
  rpc: TxRpc;
  priorityFee: PriorityFeeBounds;
  /** The pause between two broadcasts of the same bytes. Tests make it return at once. */
  wait?: (ms: number) => Promise<void>;
};

/** What a transaction will cost, available before the user confirms (the « ≈ » of §9.5). */
export type FeeEstimate = {
  /** Price of one compute unit, already inside the bounds. */
  microLamportsPerCu: bigint;
  /** What the Compute Budget instruction asks for: the simulation plus `CU_MARGIN`. */
  computeUnitLimit: number;
  baseFeeLamports: Lamports;
  priorityFeeLamports: Lamports;
  totalFeeLamports: Lamports;
};

/** The business instructions of a transaction: the Compute Budget pair is added by `tx/`. */
export type TxDraft = {
  feePayer: string;
  instructions: TransactionInstruction[];
  /** V2 (`v0` message with lookup tables); a transfer has none. */
  lookupTables?: AddressLookupTableAccount[];
};

/**
 * Where a signature comes from. A `vault` source is decrypted inside `withSigner` only, at the
 * moment of signing; an `ephemeral` one is a keypair the caller generated (the mint of V2-03).
 */
export type SignerSource =
  | { kind: "vault"; vault: KeyVault; enc: StoredSecret; address: string }
  | { kind: "ephemeral"; signer: SolanaSigner };

export type TxSuccess = {
  ok: true;
  signature: string;
  slot: number;
  /** The fees we estimated and asked for, not what the block charged (`meta.fee`). */
  feeLamports: Lamports;
  /** What a transfer moved, once `max` has been turned into a number. */
  amountLamports?: Lamports;
};

/** Everything a transfer screen needs to show before it sends (§9.5). */
export type TransferQuote = {
  from: string;
  to: string;
  /** `debit`: the fees come out of a total (the funding of a launch wallet). */
  mode: "exact" | "max" | "debit";
  amountLamports: Lamports;
  balanceLamports: Lamports;
  destinationLamports: Lamports;
  rentMinLamports: Lamports;
  fee: FeeEstimate;
};
