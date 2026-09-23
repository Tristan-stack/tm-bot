import { createLogger } from "@launchbot/shared/server";
import { PublicKey } from "@solana/web3.js";
import type { PriorityFeeBounds, TxRpc } from "./types.js";

const log = createLogger("solana:tx");

/** Limit of `getRecentPrioritizationFees`: more accounts and the RPC refuses the call. */
const MAX_LOCKED_ACCOUNTS = 128;

export type PriorityFeeReader = Pick<TxRpc, "getRecentPrioritizationFees">;

/**
 * The median, zeros included. An even count takes the mean of the two middle values rounded up
 * (proposal): between two slots that ask for 2 and 3, pay 3. `undefined` for an empty list.
 */
export function medianMicroLamports(fees: readonly number[]): bigint | undefined {
  if (fees.length === 0) return undefined;
  const sorted = [...fees].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const high = BigInt(sorted[middle] ?? 0);
  if (sorted.length % 2 === 1) return high;
  const low = BigInt(sorted[middle - 1] ?? 0);
  return (low + high + 1n) / 2n;
}

/**
 * What one compute unit is worth right now, in microlamports, inside the bounds of §12. Read
 * just before every broadcast and never cached: a fee from two minutes ago is not a fee.
 *
 * The accounts are the ones the transaction writes, the payer included: prioritization is
 * measured per account, and what matters is the contention on the accounts we lock. An RPC
 * that cannot answer gives the minimum (proposal): a transaction still goes out.
 */
export async function estimatePriorityFee(
  rpc: PriorityFeeReader,
  writable: readonly string[],
  bounds: PriorityFeeBounds,
): Promise<bigint> {
  const min = BigInt(bounds.minMicroLamports);
  const max = BigInt(bounds.maxMicroLamports);
  const accounts = [...new Set(writable)]
    .slice(0, MAX_LOCKED_ACCOUNTS)
    .map((address) => new PublicKey(address));

  let median: bigint | undefined;
  try {
    const recent = await rpc.getRecentPrioritizationFees({ lockedWritableAccounts: accounts });
    median = medianMicroLamports(recent.map((fee) => fee.prioritizationFee));
  } catch (error) {
    log.warn({ err: error }, "Priority fee unavailable, falling back to the minimum");
    return min;
  }
  if (median === undefined) return min;
  return median < min ? min : median > max ? max : median;
}
