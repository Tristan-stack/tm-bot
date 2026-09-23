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

/** §9.3: a wallet that still holds more than the fees of a withdrawal cannot be deleted. */
export const isBalanceWithdrawable = (lamports: bigint, feeBudgetLamports: bigint): boolean =>
  lamports > feeBudgetLamports;
