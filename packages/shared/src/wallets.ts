import {
  BASE_FEE_LAMPORTS,
  MICROLAMPORTS_PER_LAMPORT,
  TRANSFER_COMPUTE_UNIT_LIMIT,
  WALLET_LIMITS,
  WALLET_READY_MIN_LAMPORTS,
} from "./constants.js";
import type { Plan } from "./constants.js";

/** 3 wallets without a subscription, 5 in Classic, 10 in Premium (§8.1, §9.1, D1). */
export const getWalletLimit = (plan: Plan | null): number => WALLET_LIMITS[plan ?? "NONE"];

/** A wallet can launch from 1.050 SOL: the smallest dev buy plus the fee margin (D13). */
export const isWalletReady = (lamports: bigint): boolean => lamports >= WALLET_READY_MIN_LAMPORTS;

/**
 * What one withdrawal can cost at most: the base fee plus the priority fee at its ceiling
 * (`PRIORITY_FEE_MAX_MICROLAMPORTS`, passed in: shared never reads the environment). A wallet
 * whose balance no withdrawal could move is never blocked by it (V1-11, proposal until V1-13).
 */
export function getWithdrawFeeBudgetLamports(priorityFeeMaxMicrolamports: number): bigint {
  const priority = Math.ceil(
    (priorityFeeMaxMicrolamports * TRANSFER_COMPUTE_UNIT_LIMIT) / MICROLAMPORTS_PER_LAMPORT,
  );
  return BASE_FEE_LAMPORTS + BigInt(priority);
}

/** §9.3: a wallet that still holds more than the fees of a withdrawal cannot be deleted. */
export const isBalanceWithdrawable = (lamports: bigint, feeBudgetLamports: bigint): boolean =>
  lamports > feeBudgetLamports;
