import type { TxFailureCode } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { SendTransactionError, SystemProgram } from "@solana/web3.js";
import { RpcUnavailableError } from "../rpc.js";
import type { Lamports } from "./types.js";

const log = createLogger("solana:tx");

/** Where the transaction ended up. `yes`: the network took its fees, a retry pays again. */
export type TxLanded = "no" | "yes" | "unknown";

/**
 * Why a transaction did not go through. The screen reads `code` for its text (`en.tx.errors`),
 * the amounts for what it formats, and `landed` to decide whether it may say « Nothing was
 * sent. ». `detail` is for the logs: a short program code, never a key, never a secret (§9.6).
 */
export type TxFailure = {
  ok: false;
  code: TxFailureCode;
  landed: TxLanded;
  signature?: string;
  missingLamports?: Lamports;
  rentMinLamports?: Lamports;
  maxLamports?: Lamports;
  detail?: string;
};

type TxFailureExtra = Omit<TxFailure, "ok" | "code" | "landed">;

/** Nothing left the wallet: everything that fails before the first broadcast. */
export const notSent = (code: TxFailureCode, extra: TxFailureExtra = {}): TxFailure => ({
  ok: false,
  code,
  landed: "no",
  ...extra,
});

/**
 * The program of every instruction of a compiled message, in order: the Compute Budget pair
 * that `compileTransaction` puts first, then the draft. A program error names an index in it.
 */
export type ProgramIds = readonly string[];

/**
 * What a `Custom` code means, by program. `Custom(1)` of pump.fun is not `Custom(1)` of the
 * System program: V2-03 adds its line here. A program or a code without one is a rejection.
 */
const PROGRAM_ERRORS: Record<string, (code: number) => TxFailureCode | undefined> = {
  // `ResultWithNegativeLamports`: the debit would leave the payer below zero.
  [SystemProgram.programId.toBase58()]: (code) => (code === 1 ? "INSUFFICIENT_FUNDS" : undefined),
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

const CUSTOM_IN_MESSAGE = /Instruction (\d+): custom program error: 0x([0-9a-f]+)/i;

/**
 * A program error in both shapes it reaches us: `{ InstructionError: [index, { Custom: code }] }`
 * from a simulation or a landed transaction, and `Error processing Instruction 2: custom program
 * error: 0x1` from a broadcast that preflight refused (web3.js keeps only the message).
 */
function customErrorOf(err: unknown): { index: number; code: number } | undefined {
  if (typeof err === "string") {
    const match = CUSTOM_IN_MESSAGE.exec(err);
    const [, index, code] = match ?? [];
    return index === undefined || code === undefined
      ? undefined
      : { index: Number(index), code: parseInt(code, 16) };
  }
  const inner = record(err)?.["InstructionError"];
  if (!Array.isArray(inner)) return undefined;
  const index: unknown = inner[0];
  const code: unknown = record(inner[1])?.["Custom"];
  return typeof index === "number" && typeof code === "number" ? { index, code } : undefined;
}

/** Proposal: enough to recognize the error in the logs, short enough to never carry a body. */
const DETAIL_MAX_CHARS = 120;

/** The error as one short line. Solana never puts a key in it: it only knows public data. */
export function describeError(err: unknown): string | undefined {
  if (err === null || err === undefined) return undefined;
  const text = typeof err === "string" ? err : JSON.stringify(err);
  if (text === undefined || text === "") return undefined;
  return text.length > DETAIL_MAX_CHARS ? `${text.slice(0, DETAIL_MAX_CHARS)}…` : text;
}

/** Proposal: enough of a failed simulation to recognize the failing instruction in the logs. */
const LOG_LINES = 5;
const LOG_LINE_MAX_CHARS = 200;

/** The tail of the program logs, for the warning of a refused transaction. */
export const shortLogs = (logs: readonly string[] | null | undefined): string[] =>
  (logs ?? []).slice(-LOG_LINES).map((line) => line.slice(0, LOG_LINE_MAX_CHARS));

/** The fee payer is always the first key of a message: index 0 is the wallet we debit. */
const FEE_PAYER_INDEX = 0;

/** `{ InsufficientFundsForRent: { account_index } }`, or the same thing said in a message. */
function rentAccountIndex(err: unknown): number | undefined {
  const structured = record(record(err)?.["InsufficientFundsForRent"])?.["account_index"];
  if (typeof structured === "number") return structured;
  if (typeof err !== "string") return undefined;
  const match = /account \((\d+)\)[^)]*insufficient funds for rent/i.exec(err);
  const index = match?.[1];
  return index === undefined ? undefined : Number(index);
}

const INSUFFICIENT = /AccountNotFound|InsufficientFundsForFee|insufficient (lamports|funds)/i;
const EXPIRED = /BlockhashNotFound|blockhash not found|block height exceeded/i;

/**
 * The failure of a `TransactionError`, whether it comes from a simulation, from a refused
 * broadcast (as text) or from the `meta.err` of a transaction that landed. `programs` tells
 * which program a `Custom` code belongs to; without it, a custom code is a plain rejection.
 */
export function failureOfTransactionError(
  err: unknown,
  landed: TxLanded,
  programs: ProgramIds = [],
): TxFailure {
  const detail = describeError(err);

  const custom = customErrorOf(err);
  if (custom !== undefined) {
    const program = programs[custom.index];
    const code = program === undefined ? undefined : PROGRAM_ERRORS[program]?.(custom.code);
    if (code !== undefined) return { ok: false, code, landed, detail };
  }

  const rentIndex = rentAccountIndex(err);
  if (rentIndex !== undefined) {
    // The payer keeps too little to stay rent exempt; any other index is the destination.
    const code = rentIndex === FEE_PAYER_INDEX ? "REMAINING_BELOW_RENT" : "DESTINATION_BELOW_RENT";
    return { ok: false, code, landed, detail };
  }
  const text = typeof err === "string" ? err : (detail ?? "");
  if (INSUFFICIENT.test(text)) return { ok: false, code: "INSUFFICIENT_FUNDS", landed, detail };
  if (EXPIRED.test(text)) return { ok: false, code: "BLOCKHASH_EXPIRED", landed, detail };
  return { ok: false, code: "TRANSACTION_REJECTED", landed, detail };
}

/** What a thrown error says: the RPC message of a refused broadcast, else the message itself. */
export const messageOf = (error: unknown): string =>
  error instanceof SendTransactionError
    ? error.transactionError.message
    : error instanceof Error
      ? error.message
      : String(error);

/** The program logs a refused broadcast carries, when it does. */
export const logsOf = (error: unknown): string[] | undefined =>
  error instanceof SendTransactionError ? error.transactionError.logs : undefined;

/**
 * The failure of an RPC call that threw. The RPC being down is `RPC_UNAVAILABLE` with the
 * `landed` the caller knows (`unknown` once bytes may have left); anything else is an answer of
 * the RPC, read as text.
 */
export function failureOfThrown(
  error: unknown,
  unavailable: TxLanded,
  programs: ProgramIds,
): TxFailure {
  if (error instanceof RpcUnavailableError) {
    return { ok: false, code: "RPC_UNAVAILABLE", landed: unavailable };
  }
  return failureOfTransactionError(messageOf(error), "no", programs);
}

/**
 * A read that failed before anything was sent: the RPC being down is a failure the screen can
 * show, anything else (an invalid address, a bad parameter) is a bug this must not hide.
 */
export function rpcReadFailure(error: unknown, action: string): TxFailure {
  if (!(error instanceof RpcUnavailableError)) throw error;
  log.warn({ err: error }, `RPC unavailable: ${action}`);
  return notSent("RPC_UNAVAILABLE");
}
