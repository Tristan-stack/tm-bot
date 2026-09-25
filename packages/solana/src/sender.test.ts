import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { findLastSender } from "./sender.js";
import type { SenderReader } from "./sender.js";

const DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const PAYER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TREASURY = "3pLmYwq1Z4QhTk9Rcbb3UAHdSjyrpYmG5pDxJHzEAa81";

const transfer = (source: string, destination: string) => ({
  program: "system",
  programId: { toBase58: () => "11111111111111111111111111111111" },
  parsed: { type: "transfer", info: { source, destination, lamports: 1 } },
});

/** Signatures newest first, as the RPC gives them, each with its parsed instructions. */
function fakeRpc(history: { signature: string; err?: unknown; instructions: unknown[] }[]) {
  const byId = new Map(history.map((entry) => [entry.signature, entry]));
  const rpc = {
    getSignaturesForAddress: vi.fn(() =>
      Promise.resolve(history.map(({ signature, err }) => ({ signature, err: err ?? null }))),
    ),
    getParsedTransaction: vi.fn((signature: string) =>
      Promise.resolve({
        transaction: { message: { instructions: byId.get(signature)?.instructions ?? [] } },
      } as unknown as ParsedTransactionWithMeta),
    ),
  };
  return rpc as typeof rpc & SenderReader;
}

describe("findLastSender (V1-33, proposal)", () => {
  it("names the source of the last transfer into the address, past the moves out of it", async () => {
    const rpc = fakeRpc([
      { signature: "sweep", instructions: [transfer(DEPOSIT, TREASURY)] },
      { signature: "payment", instructions: [transfer(PAYER, DEPOSIT)] },
    ]);

    await expect(findLastSender(rpc, DEPOSIT)).resolves.toBe(PAYER);
    expect(rpc.getParsedTransaction).toHaveBeenCalledTimes(2);
  });

  it("skips a failed transaction and says null when nothing is found", async () => {
    const rpc = fakeRpc([
      { signature: "failed", err: { InstructionError: [0, "Custom"] }, instructions: [] },
      { signature: "other", instructions: [{ programId: {}, accounts: [], data: "" }] },
    ]);

    await expect(findLastSender(rpc, DEPOSIT)).resolves.toBeNull();
    expect(rpc.getParsedTransaction).toHaveBeenCalledOnce();
  });

  it("reads a few transactions at most", async () => {
    const rpc = fakeRpc([]);

    await findLastSender(rpc, DEPOSIT);

    expect(rpc.getSignaturesForAddress).toHaveBeenCalledWith(expect.anything(), { limit: 5 });
  });
});
