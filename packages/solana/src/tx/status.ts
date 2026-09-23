import type { SignatureStatus } from "@solana/web3.js";
import { RpcUnavailableError } from "../rpc.js";
import { describeError } from "./errors.js";
import type { TxRpc } from "./types.js";

export type StatusReader = Pick<TxRpc, "getSignatureStatuses">;

/**
 * What became of a signature: it landed, it landed and failed, it sits in a block the cluster
 * has not confirmed yet, the cluster has no trace of it, or the RPC could not say.
 */
export type SignatureOutcome =
  | { status: "confirmed"; slot: number }
  | { status: "failed"; slot: number; detail?: string }
  /** Neither landed nor gone: a block still being voted on. Never a reason to sign again. */
  | { status: "processed"; slot: number }
  | { status: "not_found" }
  | { status: "unavailable" };

/** One entry of `getSignatureStatuses`, read the same way by the sender and by a later look. */
export function outcomeOf(
  status: SignatureStatus | null | undefined,
): Exclude<SignatureOutcome, { status: "unavailable" }> {
  if (status === null || status === undefined) return { status: "not_found" };
  if (status.err !== null) {
    return { status: "failed", slot: status.slot, detail: describeError(status.err) };
  }
  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
    return { status: "confirmed", slot: status.slot };
  }
  return { status: "processed", slot: status.slot };
}

/**
 * One read, history included (V1-14, Try again after `CONFIRMATION_UNKNOWN`). `not_found` does
 * not mean « will never land »: a transaction is only dead once its blockhash expired, which
 * the caller judges by the age of its attempt.
 */
export async function lookupSignature(
  rpc: StatusReader,
  signature: string,
): Promise<SignatureOutcome> {
  let status;
  try {
    ({
      value: [status],
    } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }));
  } catch (error) {
    if (error instanceof RpcUnavailableError) return { status: "unavailable" };
    throw error;
  }
  return outcomeOf(status);
}
