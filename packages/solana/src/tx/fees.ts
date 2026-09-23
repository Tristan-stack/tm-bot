import { BASE_FEE_LAMPORTS, priorityFeeLamports } from "@launchbot/shared";
import { signaturesOf, simulateComputeUnits, writableAccountsOf } from "./compute-units.js";
import type { TxFailure } from "./errors.js";
import { estimatePriorityFee } from "./priority-fee.js";
import type { FeeEstimate, TxContext, TxDraft } from "./types.js";

/**
 * What the transaction will cost: one base fee per signature plus the priority fee of the
 * **limit we ask for**, not of what the simulation consumed. `getFeeForMessage` is not used:
 * it answers on the message only, and would have to be checked against a double count of the
 * priority fee at every version of the RPC.
 */
export function feeEstimateOf(
  microLamportsPerCu: bigint,
  computeUnitLimit: number,
  signatures: number,
): FeeEstimate {
  const baseFeeLamports = BASE_FEE_LAMPORTS * BigInt(signatures);
  const priority = priorityFeeLamports(computeUnitLimit, microLamportsPerCu);
  return {
    microLamportsPerCu,
    computeUnitLimit,
    baseFeeLamports,
    priorityFeeLamports: priority,
    totalFeeLamports: baseFeeLamports + priority,
  };
}

/** True of everything `tx/` returns that is not the value asked for. */
export const isTxFailure = (value: object): value is TxFailure =>
  "ok" in value && value.ok === false;

const priorityFeeOfDraft = (ctx: TxContext, draft: TxDraft): Promise<bigint> =>
  estimatePriorityFee(ctx.rpc, writableAccountsOf(draft), ctx.priorityFee);

/**
 * The fees of a draft, available before the user confirms (the « ≈ » of §9.5): the priority
 * fee of the moment and one simulation for the compute units, read together — the units a
 * transaction consumes do not depend on the price it pays. The draft is simulated at the floor
 * of the bounds: simulated at the real price, the ceiling limit it carries would cost a fee the
 * real transaction never pays, and refuse a wallet that can afford it. A simulation that fails
 * returns its `TxFailure`: the caller must not send anything.
 */
export async function estimateFees(
  ctx: TxContext,
  draft: TxDraft,
): Promise<FeeEstimate | TxFailure> {
  const [microLamportsPerCu, units] = await Promise.all([
    priorityFeeOfDraft(ctx, draft),
    simulateComputeUnits(ctx.rpc, draft, BigInt(ctx.priorityFee.minMicroLamports)),
  ]);
  if (typeof units !== "number") return units;
  return feeEstimateOf(microLamportsPerCu, units, signaturesOf(draft));
}

/**
 * The same estimate with a freshly read priority fee, keeping the compute units of the first
 * simulation: what a second attempt needs, without simulating the same instructions again.
 */
export async function refreshPriorityFee(
  ctx: TxContext,
  draft: TxDraft,
  previous: FeeEstimate,
): Promise<FeeEstimate> {
  const microLamportsPerCu = await priorityFeeOfDraft(ctx, draft);
  return feeEstimateOf(microLamportsPerCu, previous.computeUnitLimit, signaturesOf(draft));
}
