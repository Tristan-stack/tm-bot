import { PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";

export type SenderReader = Pick<Connection, "getSignaturesForAddress" | "getParsedTransaction">;

/** Transactions of the address read at most (proposal): a deposit address has a few. */
const MAX_SIGNATURES = 5;

type ParsedTransfer = { type?: unknown; info?: { source?: unknown; destination?: unknown } };

/**
 * The address that last sent SOL to `address` by a System transfer: the « From » line of an
 * admin alert (V1-33, proposal). `null` when none of its last transactions says so; the
 * transfers out of `address` (to the treasury) are skipped.
 */
export async function findLastSender(rpc: SenderReader, address: string): Promise<string | null> {
  const signatures = await rpc.getSignaturesForAddress(new PublicKey(address), {
    limit: MAX_SIGNATURES,
  });
  for (const { signature, err } of signatures) {
    if (err !== null) continue;
    const transaction = await rpc.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    for (const instruction of transaction?.transaction.message.instructions ?? []) {
      if (!("parsed" in instruction) || instruction.program !== "system") continue;
      const { type, info } = instruction.parsed as ParsedTransfer;
      if (type === "transfer" && info?.destination === address && typeof info.source === "string") {
        return info.source;
      }
    }
  }
  return null;
}
