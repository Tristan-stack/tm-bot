import {
  BASE_FEE_LAMPORTS,
  MICROLAMPORTS_PER_LAMPORT,
  TRANSFER_COMPUTE_UNIT_LIMIT,
  WALLET_LIMITS,
} from "./constants.js";
import type { Plan } from "./constants.js";

/** 3 wallets without a subscription, 5 in Classic, 10 in Premium (§8.1, §9.1, D1). */
export const getWalletLimit = (plan: Plan | null): number => WALLET_LIMITS[plan ?? "NONE"];

const MICROLAMPORTS = BigInt(MICROLAMPORTS_PER_LAMPORT);

/** `ceil(units × µL / 1 000 000)`: what a compute budget costs, never rounded down (V1-13). */
export const priorityFeeLamports = (computeUnits: number, microLamportsPerCu: bigint): bigint =>
  (BigInt(computeUnits) * microLamportsPerCu + MICROLAMPORTS - 1n) / MICROLAMPORTS;

/** The fees of one standard SOL transfer at a priority fee: one signature, the unit ceiling. */
export const transferFeeLamports = (microLamportsPerCu: bigint): bigint =>
  BASE_FEE_LAMPORTS + priorityFeeLamports(TRANSFER_COMPUTE_UNIT_LIMIT, microLamportsPerCu);

/**
 * What one withdrawal can cost at most: the standard transfer at the ceiling of the bounds
 * (`PRIORITY_FEE_MAX_MICROLAMPORTS`, passed in: shared never reads the environment). A wallet
 * whose balance no withdrawal could move is never blocked by it (V1-11); a test of
 * @launchbot/solana keeps it above what a real transfer is estimated at.
 */
export const getWithdrawFeeBudgetLamports = (priorityFeeMaxMicrolamports: number): bigint =>
  transferFeeLamports(BigInt(priorityFeeMaxMicrolamports));

/** What is left to send once the fees are paid (§9.5): 0 is a valid amount, never less. */
export const computeMaxAmount = (balance: bigint, fee: bigint): bigint =>
  balance > fee ? balance - fee : 0n;

/**
 * What a balance lacks to send `amount` plus its fees under the rules of §9.5 (`validateTransfer`
 * of V1-13): 0 when it can. The balance left must be 0 or at least the rent-exempt minimum, so a
 * dust left adds what brings it to that minimum (proposal, Pay from my wallet V1-31).
 */
export function transferShortfall(checks: {
  balance: bigint;
  amount: bigint;
  fee: bigint;
  rentMin: bigint;
}): bigint {
  const left = checks.balance - checks.amount - checks.fee;
  if (left < 0n) return -left;
  return left > 0n && left < checks.rentMin ? checks.rentMin - left : 0n;
}

/** §9.3: a wallet that still holds more than the fees of a withdrawal cannot be deleted. */
export const isBalanceWithdrawable = (lamports: bigint, feeBudgetLamports: bigint): boolean =>
  lamports > feeBudgetLamports;
