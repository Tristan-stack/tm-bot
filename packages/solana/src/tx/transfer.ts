import { transferFeeLamports } from "@launchbot/shared";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getBalancesFresh } from "../lamports.js";
import { notSent, rpcReadFailure } from "./errors.js";
import type { TxFailure } from "./errors.js";
import { estimateFees, isTxFailure } from "./fees.js";
import { estimatePriorityFee } from "./priority-fee.js";
import { getRentExemptMinimum } from "./rent.js";
import { sendAndConfirm } from "./send.js";
import type { SendTxOptions } from "./send.js";
import type {
  FeeEstimate,
  Lamports,
  SignerSource,
  TransferQuote,
  TxContext,
  TxDraft,
  TxSuccess,
} from "./types.js";

/** A bare SOL transfer. The Compute Budget pair is added by `compileTransaction`. */
export const transferDraft = (from: string, to: string, lamports: Lamports): TxDraft => ({
  feePayer: from,
  instructions: [
    SystemProgram.transfer({
      fromPubkey: new PublicKey(from),
      toPubkey: new PublicKey(to),
      lamports,
    }),
  ],
});

/** What is left to send once the fees are paid: 0 is a valid amount, a negative one is not. */
export const computeMaxAmount = (balance: Lamports, fee: Lamports): Lamports =>
  balance - fee > 0n ? balance - fee : 0n;

export type TransferChecks = {
  balance: Lamports;
  amount: Lamports;
  fee: Lamports;
  rentMin: Lamports;
  destinationLamports: Lamports;
};

/**
 * The rules of §9.5, in order, before anything is signed: the amount, the fees, what the wallet
 * keeps and what the destination receives. An empty balance left is fine — 0 needs no rent —
 * but a dust balance under the rent-exempt minimum would be refused by the runtime.
 */
export function validateTransfer(checks: TransferChecks): TxFailure[] {
  const { balance, amount, fee, rentMin, destinationLamports } = checks;
  if (amount <= 0n) return [notSent("INVALID_AMOUNT")];

  const failures: TxFailure[] = [];
  const remaining = balance - amount - fee;
  if (remaining < 0n) {
    failures.push(notSent("INSUFFICIENT_FUNDS", { missingLamports: -remaining }));
  } else if (remaining !== 0n && remaining < rentMin) {
    failures.push(
      notSent("REMAINING_BELOW_RENT", {
        rentMinLamports: rentMin,
        maxLamports: computeMaxAmount(balance, fee),
      }),
    );
  }
  // An account that does not exist yet is created by the transfer: it must be rent exempt.
  if (destinationLamports === 0n && amount < rentMin) {
    failures.push(notSent("DESTINATION_BELOW_RENT", { rentMinLamports: rentMin }));
  }
  return failures;
}

/**
 * The fees of a standard transfer at the priority fee of the moment, without simulating: the
 * formula of the V1-11 budget, with the price of now in place of the ceiling.
 */
export async function estimateTransferFee(ctx: TxContext, from: string): Promise<Lamports> {
  return transferFeeLamports(await estimatePriorityFee(ctx.rpc, [from], ctx.priorityFee));
}

/** The balance of `from`, the lamports of `to` and the rent-exempt minimum, in two calls. */
async function readChain(
  ctx: TxContext,
  from: string,
  to: string,
): Promise<{ balance: Lamports; destination: Lamports; rentMin: Lamports }> {
  const [balances, rentMin] = await Promise.all([
    getBalancesFresh(ctx.rpc, [from, to]),
    getRentExemptMinimum(ctx.rpc),
  ]);
  return { balance: balances.get(from) ?? 0n, destination: balances.get(to) ?? 0n, rentMin };
}

/**
 * Everything the confirmation screen of a withdrawal needs (§9.5), with nothing signed and no
 * key decrypted: the balances read without the cache of V1-07, the rent-exempt minimum, the
 * fees of the real transaction, then the rules. `max` means « the whole balance minus fees ».
 *
 * The address of `to` must already be valid (`solanaAddressSchema`): an address that cannot be
 * decoded is a bug of the caller, not a failure of the transfer.
 */
export async function prepareTransfer(
  ctx: TxContext,
  params: { from: string; to: string; amount: Lamports | "max" },
): Promise<TransferQuote | TxFailure> {
  const { from, to, amount } = params;
  const mode = amount === "max" ? "max" : "exact";

  let balance: Lamports;
  let destination: Lamports;
  let rentMin: Lamports;
  try {
    ({ balance, destination, rentMin } = await readChain(ctx, from, to));
  } catch (error) {
    return rpcReadFailure(error, "balances");
  }

  // What costs nothing to refuse is refused before the simulation.
  if (amount !== "max") {
    if (amount <= 0n) return notSent("INVALID_AMOUNT");
    if (amount > balance) {
      return notSent("INSUFFICIENT_FUNDS", { missingLamports: amount - balance });
    }
    if (destination === 0n && amount < rentMin) {
      return notSent("DESTINATION_BELOW_RENT", { rentMinLamports: rentMin });
    }
  }

  // The compute units of a transfer do not depend on the amount: `max` simulates a small one,
  // never the whole balance, which would fail for want of fees.
  const simulated = amount === "max" ? (balance < rentMin ? 0n : rentMin) : amount;
  const fee = await estimateFees(ctx, transferDraft(from, to, simulated));
  if (isTxFailure(fee)) return fee;

  const amountLamports =
    amount === "max" ? computeMaxAmount(balance, fee.totalFeeLamports) : amount;
  const [failure] = validateTransfer({
    balance,
    amount: amountLamports,
    fee: fee.totalFeeLamports,
    rentMin,
    destinationLamports: destination,
  });
  if (failure !== undefined) return failure;

  return {
    from,
    to,
    mode,
    amountLamports,
    balanceLamports: balance,
    destinationLamports: destination,
    rentMinLamports: rentMin,
    fee,
  };
}

/**
 * Signs and sends the transfer of a quote. The quote is made again first — the balances move,
 * and the fees of a minute ago are not the fees of now — so a quote the user confirmed late is
 * refused rather than sent wrong. The key is decrypted only inside `sendAndConfirm`, to sign.
 */
export async function sendTransfer(
  ctx: TxContext,
  quote: TransferQuote,
  signer: SignerSource,
  options: Pick<SendTxOptions, "onSubmitted"> = {},
): Promise<TxSuccess | TxFailure> {
  const { from, to, mode } = quote;
  const fresh = await prepareTransfer(ctx, {
    from,
    to,
    amount: mode === "max" ? "max" : quote.amountLamports,
  });
  if (isTxFailure(fresh)) return fresh;

  // The amount of an attempt follows its fee: `max` leaves exactly 0 lamport, whatever the
  // priority fee of a second attempt, and the rules of §9.5 are checked again for it.
  const amountFor = (totalFee: Lamports): Lamports =>
    mode === "max" ? computeMaxAmount(fresh.balanceLamports, totalFee) : fresh.amountLamports;
  const build = (fee: FeeEstimate): TxDraft | TxFailure => {
    const amount = amountFor(fee.totalFeeLamports);
    const [failure] = validateTransfer({
      balance: fresh.balanceLamports,
      amount,
      fee: fee.totalFeeLamports,
      rentMin: fresh.rentMinLamports,
      destinationLamports: fresh.destinationLamports,
    });
    return failure ?? transferDraft(from, to, amount);
  };

  const result = await sendAndConfirm(
    ctx,
    transferDraft(from, to, fresh.amountLamports),
    [signer],
    {
      fee: fresh.fee,
      build,
      onSubmitted: options.onSubmitted,
    },
  );
  return result.ok ? { ...result, amountLamports: amountFor(result.feeLamports) } : result;
}
