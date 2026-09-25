import type { Env } from "@launchbot/shared/server";
import { getSolanaRpc } from "../rpc.js";
import type { TxFailure } from "./errors.js";
import { getRentExemptMinimum } from "./rent.js";
import { lookupSignature } from "./status.js";
import type { SignatureOutcome } from "./status.js";
import { estimateTransferFee, prepareTransfer, sendTransfer } from "./transfer.js";
import type { TransferRequest } from "./transfer.js";
import type { SignerSource, TransferQuote, TxContext, TxSuccess } from "./types.js";

/**
 * The transaction helpers of V1-13 bound to a process: what the withdrawal (V1-14), the payment
 * from a wallet (V1-31) and the treasury (V1-33) are handed — `@launchbot/db` does not load this
 * package, it is given these.
 */
export type TransferApi = {
  estimateFee: (from: string) => Promise<bigint>;
  rentMin: () => Promise<bigint>;
  prepare: (params: {
    from: string;
    to: string;
    amount: bigint | "max";
  }) => Promise<TransferQuote | TxFailure>;
  send: (
    request: TransferRequest,
    signer: SignerSource,
    options?: {
      onPrepared?: (quote: TransferQuote) => Promise<void>;
      onSubmitted?: (signature: string) => Promise<void>;
    },
  ) => Promise<TxSuccess | TxFailure>;
  lookup: (signature: string) => Promise<SignatureOutcome>;
};

/**
 * On the connection of the process, the one its devnet guard verified (so the rent cache is
 * one), with the priority fee bounds of §12.
 */
export function createTransferApi(
  env: Pick<
    Env,
    "SOLANA_RPC_URL" | "PRIORITY_FEE_MIN_MICROLAMPORTS" | "PRIORITY_FEE_MAX_MICROLAMPORTS"
  >,
): TransferApi {
  const ctx: TxContext = {
    rpc: getSolanaRpc(env.SOLANA_RPC_URL),
    priorityFee: {
      minMicroLamports: env.PRIORITY_FEE_MIN_MICROLAMPORTS,
      maxMicroLamports: env.PRIORITY_FEE_MAX_MICROLAMPORTS,
    },
  };
  return {
    estimateFee: (from) => estimateTransferFee(ctx, from),
    rentMin: () => getRentExemptMinimum(ctx.rpc),
    prepare: (params) => prepareTransfer(ctx, params),
    send: (request, signer, options) => sendTransfer(ctx, request, signer, options),
    lookup: (signature) => lookupSignature(ctx.rpc, signature),
  };
}
