import { REBROADCAST_INTERVAL_MS, TX_CONFIRM_TIMEOUT_MS, TX_MAX_ATTEMPTS } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import bs58 from "bs58";
import type { VersionedTransaction } from "@solana/web3.js";
import type { SolanaSigner } from "../keys/vault.js";
import { compileTransaction, programsOf } from "./compute-units.js";
import {
  describeError,
  failureOfThrown,
  logsOf,
  messageOf,
  notSent,
  rpcReadFailure,
  shortLogs,
} from "./errors.js";
import type { TxFailure } from "./errors.js";
import { estimateFees, isTxFailure, refreshPriorityFee } from "./fees.js";
import type { FeeEstimate, SignerSource, TxContext, TxDraft, TxSuccess } from "./types.js";

const log = createLogger("solana:tx");

/** How many polls the confirmation timeout allows at the rebroadcast pace. */
const MAX_CONFIRM_POLLS = Math.ceil(TX_CONFIRM_TIMEOUT_MS / REBROADCAST_INTERVAL_MS);

export type SendTxOptions = {
  /** The estimate the caller just made: used as is for the first attempt. */
  fee?: FeeEstimate;
  /** The signature, before the confirmation: V1-14 writes it on its PENDING row. */
  onSubmitted?: (signature: string) => Promise<void>;
  /**
   * The instructions for the fee of an attempt, rules included: a `max` transfer leaves exactly
   * 0 lamport, so a higher priority fee on the second attempt means a smaller amount, and an
   * amount the rules refuse is a failure, not a broadcast. Without it, the draft is sent as is.
   */
  build?: (fee: FeeEstimate) => TxDraft | TxFailure;
};

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Every vault key is decrypted at the same moment, and zeroed as soon as `fn` returns. */
async function withSigners<T>(
  sources: readonly SignerSource[],
  fn: (signers: SolanaSigner[]) => T | Promise<T>,
): Promise<T> {
  const signers: SolanaSigner[] = [];
  const next = async (index: number): Promise<T> => {
    const source = sources[index];
    if (source === undefined) return fn(signers);
    if (source.kind === "ephemeral") {
      signers.push(source.signer);
      return next(index + 1);
    }
    // The vault refuses a key that does not own `address`, and zeroes it on the way out.
    return source.vault.withSigner(source.enc, source.address, async (signer) => {
      signers.push(signer);
      return next(index + 1);
    });
  };
  return next(0);
}

/** Only public keys here: a missing signer is a bug of the caller, not a user error. */
function assertSignersCover(transaction: VersionedTransaction, signers: SolanaSigner[]): void {
  const { header, staticAccountKeys } = transaction.message;
  const required = staticAccountKeys
    .slice(0, header.numRequiredSignatures)
    .map((key) => key.toBase58());
  const given = new Set(signers.map((signer) => signer.publicKey.toBase58()));
  const missing = required.filter((key) => !given.has(key));
  if (missing.length > 0) throw new Error(`No signer for ${missing.join(", ")}`);
}

/** The signed bytes and the signature of the fee payer, which is the one of the transaction. */
async function signTransaction(
  transaction: VersionedTransaction,
  signers: readonly SignerSource[],
): Promise<{ raw: Uint8Array; signature: string }> {
  return withSigners(signers, (keypairs) => {
    assertSignersCover(transaction, keypairs);
    transaction.sign(keypairs);
    const [primary] = transaction.signatures;
    if (primary === undefined) throw new Error("The transaction carries no signature");
    return { raw: transaction.serialize(), signature: bs58.encode(primary) };
  });
}

/** After a broadcast nothing throws: the signature must reach the caller, whatever happened. */
function unknownConfirmation(error: unknown, signature: string): TxFailure {
  log.warn({ err: error, signature }, "Confirmation unknown");
  return { ok: false, code: "CONFIRMATION_UNKNOWN", landed: "unknown", signature };
}

/** It landed and failed (§5): the fees were paid, a new attempt would pay them again. */
const landedFailure = (err: unknown, signature: string): TxFailure => ({
  ok: false,
  code: "TRANSACTION_REJECTED",
  landed: "yes",
  signature,
  detail: describeError(err),
});

/**
 * One blockhash, one signature: broadcast, then rebroadcast the very same bytes every 2 s until
 * the block height passes `lastValidBlockHeight`. The transaction is never re-signed while its
 * blockhash is valid — two signatures of the same transfer could both land.
 */
async function attemptOnce(
  ctx: TxContext,
  draft: TxDraft,
  fee: FeeEstimate,
  signers: readonly SignerSource[],
  options: SendTxOptions,
): Promise<TxSuccess | TxFailure> {
  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    ({ blockhash, lastValidBlockHeight } = await ctx.rpc.getLatestBlockhash("confirmed"));
  } catch (error) {
    return rpcReadFailure(error, "getLatestBlockhash");
  }

  const transaction = compileTransaction(draft, fee, blockhash);
  const { raw, signature } = await signTransaction(transaction, signers);

  try {
    // Preflight on the first broadcast only: it is what refuses a transfer we got wrong.
    await ctx.rpc.sendRawTransaction(raw, { preflightCommitment: "confirmed", maxRetries: 0 });
  } catch (error) {
    log.warn({ err: messageOf(error), logs: shortLogs(logsOf(error)) }, "Broadcast refused");
    return { ...failureOfThrown(error, "unknown", programsOf(draft)), signature };
  }
  await options.onSubmitted?.(signature);

  const wait = ctx.wait ?? defaultWait;
  const success = (slot: number): TxSuccess => ({
    ok: true,
    signature,
    slot,
    feeLamports: fee.totalFeeLamports,
  });
  // From here nothing throws: the signature must reach the caller, whatever happened.
  try {
    for (let poll = 0; poll < MAX_CONFIRM_POLLS; poll++) {
      await wait(REBROADCAST_INTERVAL_MS);
      const {
        value: [status],
      } = await ctx.rpc.getSignatureStatuses([signature]);
      if (status !== null && status !== undefined) {
        if (status.err !== null) return landedFailure(status.err, signature);
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
        ) {
          return success(status.slot);
        }
        // In a block, waiting for its confirmation: nothing to broadcast again.
        continue;
      }

      if ((await ctx.rpc.getBlockHeight("confirmed")) > lastValidBlockHeight) {
        // The blockhash can no longer be included. One last look, history included: found means
        // it did land, absent means it never will and a new attempt is free to re-sign.
        const {
          value: [last],
        } = await ctx.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
        if (last === null || last === undefined) return notSent("BLOCKHASH_EXPIRED");
        return last.err !== null ? landedFailure(last.err, signature) : success(last.slot);
      }

      try {
        await ctx.rpc.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
      } catch (error) {
        // A rebroadcast the RPC did not take changes nothing: the next poll reads the status.
        log.debug({ err: error, signature }, "Rebroadcast refused");
      }
    }
    return unknownConfirmation(new Error("Confirmation polls exhausted"), signature);
  } catch (error) {
    return unknownConfirmation(error, signature);
  }
}

/**
 * Sends a draft and waits for `confirmed`: the one road to the chain (§12). The priority fee is
 * read again for every attempt, and a transaction whose blockhash expired without landing is
 * re-signed on a fresh one, `TX_MAX_ATTEMPTS` times at most.
 */
export async function sendAndConfirm(
  ctx: TxContext,
  draft: TxDraft,
  signers: readonly SignerSource[],
  options: SendTxOptions = {},
): Promise<TxSuccess | TxFailure> {
  const first = options.fee ?? (await estimateFees(ctx, draft));
  if (isTxFailure(first)) return first;
  let fee = first;

  for (let attempt = 1; ; attempt++) {
    // The compute units of the first simulation stay; the price is the price of now.
    if (attempt > 1) fee = await refreshPriorityFee(ctx, draft, fee);
    const built = options.build?.(fee) ?? draft;
    if (isTxFailure(built)) return built;

    const outcome = await attemptOnce(ctx, built, fee, signers, options);
    // Only a transaction that is nowhere to be found may be signed again.
    const vanished = !outcome.ok && outcome.code === "BLOCKHASH_EXPIRED" && outcome.landed === "no";
    if (!vanished || attempt === TX_MAX_ATTEMPTS) return outcome;
    log.warn({ attempt }, "Blockhash expired without landing, signing again");
  }
}
