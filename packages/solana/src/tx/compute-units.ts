import { CU_MARGIN, MAX_COMPUTE_UNITS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import { describeError, failureOfThrown, failureOfTransactionError, shortLogs } from "./errors.js";
import type { ProgramIds, TxFailure } from "./errors.js";
import type { FeeEstimate, TxDraft, TxRpc } from "./types.js";

const log = createLogger("solana:tx");

export type SimulateReader = Pick<TxRpc, "simulateTransaction">;

/** 32 zero bytes: the blockhash `replaceRecentBlockhash` throws away before simulating. */
const PLACEHOLDER_BLOCKHASH = PublicKey.default.toBase58();

const COMPUTE_BUDGET_PROGRAM = ComputeBudgetProgram.programId.toBase58();

/**
 * The transaction as it will be broadcast: the compute unit limit, its price, then the
 * business instructions. The message is `v0` even without a lookup table, so that a transfer
 * and a pump.fun launch (V2-03) take the exact same road.
 */
export function compileTransaction(
  draft: TxDraft,
  budget: Pick<FeeEstimate, "microLamportsPerCu" | "computeUnitLimit">,
  blockhash: string,
): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: new PublicKey(draft.feePayer),
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: budget.computeUnitLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: budget.microLamportsPerCu }),
      ...draft.instructions,
    ],
  }).compileToV0Message(draft.lookupTables);
  return new VersionedTransaction(message);
}

/** The programs of the compiled message, in its order: what a program error is indexed by. */
export const programsOf = (draft: TxDraft): ProgramIds => [
  COMPUTE_BUDGET_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  ...draft.instructions.map((instruction) => instruction.programId.toBase58()),
];

/** The fee payer, then every account of the draft that `has` the flag. */
const accountsOf = (draft: TxDraft, has: (key: AccountMeta) => boolean): string[] => [
  draft.feePayer,
  ...draft.instructions.flatMap((instruction) =>
    instruction.keys.filter(has).map((key) => key.pubkey.toBase58()),
  ),
];

/** The accounts a draft writes: what prioritization is measured on. */
export const writableAccountsOf = (draft: TxDraft): string[] =>
  accountsOf(draft, (key) => key.isWritable);

/** How many signatures the transaction will carry: the payer plus every signing account. */
export const signaturesOf = (draft: TxDraft): number =>
  new Set(accountsOf(draft, (key) => key.isSigner)).size;

/**
 * The compute unit limit to ask for: what the simulation consumed plus `CU_MARGIN`, capped by
 * the program. No signature is needed (`sigVerify: false`), so no key is decrypted here — the
 * whole point of simulating before signing. A simulation that errors sends nothing.
 */
export async function simulateComputeUnits(
  rpc: SimulateReader,
  draft: TxDraft,
  microLamportsPerCu: bigint,
): Promise<number | TxFailure> {
  const transaction = compileTransaction(
    draft,
    { microLamportsPerCu, computeUnitLimit: MAX_COMPUTE_UNITS },
    PLACEHOLDER_BLOCKHASH,
  );

  let simulated;
  try {
    ({ value: simulated } = await rpc.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    }));
  } catch (error) {
    return failureOfThrown(error, "no", programsOf(draft));
  }

  if (simulated.err !== null) {
    log.warn(
      { err: describeError(simulated.err), logs: shortLogs(simulated.logs) },
      "Transaction simulation failed, nothing sent",
    );
    return failureOfTransactionError(simulated.err, "no", programsOf(draft));
  }
  // Every RPC of this decade reports it; without it the only honest limit is a guess.
  if (simulated.unitsConsumed === undefined) {
    throw new Error("The simulation reported no unitsConsumed");
  }
  return Math.min(MAX_COMPUTE_UNITS, Math.ceil(simulated.unitsConsumed * CU_MARGIN));
}
