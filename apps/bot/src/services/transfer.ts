import type { TransferApi } from "@launchbot/db";
import type { Env } from "@launchbot/shared/server";
import {
  estimateTransferFee,
  getRentExemptMinimum,
  getSolanaRpc,
  lookupSignature,
  prepareTransfer,
  sendTransfer,
} from "@launchbot/solana";
import type { TxContext } from "@launchbot/solana";

export type TransferEnv = Pick<
  Env,
  "SOLANA_RPC_URL" | "PRIORITY_FEE_MIN_MICROLAMPORTS" | "PRIORITY_FEE_MAX_MICROLAMPORTS"
>;

/**
 * The transaction helpers of V1-13 bound to the process: the connection the devnet guard
 * verified (the same object as the reads of `createDataServices`, so the rent cache is one)
 * and the priority fee bounds of §12. What the withdrawal service is handed (V1-14).
 */
export function createTransferApi(env: TransferEnv): TransferApi {
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
