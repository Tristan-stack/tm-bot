import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SendTransactionError,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { RpcUnavailableError } from "../rpc.js";
import { notSent } from "./errors.js";
import { sendAndConfirm } from "./send.js";
import { address, fakeRpc, milliSol, testContext, vaultSigner } from "./test-rpc.js";
import type { RpcCall } from "./test-rpc.js";
import { transferDraft } from "./transfer.js";
import type { FeeEstimate, TxDraft } from "./types.js";

/** The signature of a signed transaction: a base58 no test can predict. */
const ANY_SIGNATURE = expect.any(String) as string;
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

afterEach(() => {
  setLogDestination(undefined);
});

/**
 * A wallet of the vault, a transfer from it, and the log of what the sender did: every RPC
 * call and every decryption, in order. Confirmed on the first poll unless told otherwise.
 */
function harness(over: Parameters<typeof fakeRpc>[0] = {}) {
  const calls: RpcCall[] = [];
  const wallet = vaultSigner(calls);
  const fake = fakeRpc(
    { fees: [1_000], statuses: [{ confirmationStatus: "confirmed" }], ...over },
    calls,
  );
  const draft = transferDraft(wallet.address, address(), milliSol);
  return { ...fake, ...wallet, ctx: testContext(fake), draft };
}

/** An instruction that `second` must sign, for the transactions with two signers. */
const signedBy = (payer: string, second: PublicKey): TxDraft => ({
  feePayer: payer,
  instructions: [
    new TransactionInstruction({
      programId: MEMO_PROGRAM,
      keys: [{ pubkey: second, isSigner: true, isWritable: false }],
      data: Buffer.from("hi"),
    }),
  ],
});

describe("sendAndConfirm", () => {
  it("confirms a transaction and reports its slot and its fees", async () => {
    const { ctx, draft, signer } = harness({
      statuses: [{ confirmationStatus: "confirmed", slot: 4_242 }],
    });

    expect(await sendAndConfirm(ctx, draft, [signer])).toEqual({
      ok: true,
      signature: ANY_SIGNATURE,
      slot: 4_242,
      feeLamports: 5_001n,
    });
  });

  it("decrypts the key only once everything is estimated, and to sign", async () => {
    const { ctx, draft, signer, methods } = harness();

    await sendAndConfirm(ctx, draft, [signer]);

    expect(methods().slice(0, 5)).toEqual([
      "getRecentPrioritizationFees",
      "simulateTransaction",
      "getLatestBlockhash",
      "withSigner",
      "sendRawTransaction",
    ]);
  });

  it("decrypts nothing when the simulation refuses the transaction", async () => {
    captureLogs();
    const { ctx, draft, signer, methods, sent } = harness({
      simulationError: { InstructionError: [2, { Custom: 1 }] },
    });

    const result = await sendAndConfirm(ctx, draft, [signer]);

    // `Custom(1)` of the System program, which the transfer instruction belongs to.
    expect(result).toMatchObject({ code: "INSUFFICIENT_FUNDS", landed: "no" });
    expect(methods()).not.toContain("withSigner");
    expect(sent).toHaveLength(0);
  });

  it("broadcasts the very same bytes again while the blockhash is valid", async () => {
    const { ctx, draft, signer, of, sent } = harness({
      // Nothing yet, then confirmed; the block height stays under the limit.
      statuses: [null, { confirmationStatus: "confirmed" }],
      heights: [200],
      lastValidBlockHeight: 200,
    });

    expect(await sendAndConfirm(ctx, draft, [signer])).toMatchObject({ ok: true });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(of("withSigner")).toHaveLength(1);
  });

  it("does not wait for a transaction that is confirmed on the first poll", async () => {
    const { ctx, draft, signer, sent } = harness();

    await sendAndConfirm(ctx, draft, [signer]);

    expect(sent).toHaveLength(1);
  });

  it("leaves a transaction that is in a block alone until it is confirmed", async () => {
    const { ctx, draft, signer, of, sent } = harness({
      statuses: [{ confirmationStatus: "processed" }, { confirmationStatus: "confirmed" }],
    });

    expect(await sendAndConfirm(ctx, draft, [signer])).toMatchObject({ ok: true });
    expect(sent).toHaveLength(1);
    expect(of("getBlockHeight")).toHaveLength(0);
  });

  it("signs again on a fresh blockhash when the old one expired and nothing landed", async () => {
    captureLogs();
    const { ctx, draft, signer, of, sent } = harness({
      statuses: [null],
      heights: [201],
      lastValidBlockHeight: 200,
      historyStatus: null,
    });

    const result = await sendAndConfirm(ctx, draft, [signer]);

    expect(result).toMatchObject({ ok: false, code: "BLOCKHASH_EXPIRED", landed: "no" });
    // Two attempts: two blockhashes, two decryptions, two broadcasts, and nothing landed.
    expect(of("withSigner")).toHaveLength(2);
    expect(of("getLatestBlockhash")).toHaveLength(2);
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toEqual(sent[1]);
  });

  it("builds the second attempt for the priority fee of the moment, without simulating again", async () => {
    captureLogs();
    const { ctx, draft, signer, of, state } = harness({
      statuses: [null, { confirmationStatus: "confirmed" }],
      heights: [201],
      lastValidBlockHeight: 200,
    });
    const seen: bigint[] = [];

    await sendAndConfirm(ctx, draft, [signer], {
      build: (fee) => {
        seen.push(fee.microLamportsPerCu);
        // The cluster got busier between the two attempts.
        state.fees = [2_000];
        return draft;
      },
    });

    expect(seen).toEqual([1_000n, 2_000n]);
    expect(of("getRecentPrioritizationFees")).toHaveLength(2);
    expect(of("simulateTransaction")).toHaveLength(1);
  });

  it("returns what the builder refused, and sends nothing", async () => {
    const { ctx, draft, signer, sent } = harness();

    const result = await sendAndConfirm(ctx, draft, [signer], {
      build: () => notSent("INVALID_AMOUNT"),
    });

    expect(result).toEqual({ ok: false, code: "INVALID_AMOUNT", landed: "no" });
    expect(sent).toHaveLength(0);
  });

  it("is a success when the expired transaction is found in the history", async () => {
    const { ctx, draft, signer, sent } = harness({
      statuses: [null],
      heights: [201],
      lastValidBlockHeight: 200,
      historyStatus: { slot: 99 },
    });

    expect(await sendAndConfirm(ctx, draft, [signer])).toMatchObject({ ok: true, slot: 99 });
    expect(sent).toHaveLength(1);
  });

  it("gives back the signature when the RPC goes down during the confirmation", async () => {
    captureLogs();
    const { ctx, draft, signer } = harness({
      throws: { getSignatureStatuses: new RpcUnavailableError("The RPC did not answer") },
    });

    const result = await sendAndConfirm(ctx, draft, [signer]);

    expect(result).toEqual({
      ok: false,
      code: "CONFIRMATION_UNKNOWN",
      landed: "unknown",
      signature: ANY_SIGNATURE,
    });
  });

  it("says the fees were paid when the transaction landed and failed", async () => {
    const { ctx, draft, signer } = harness({
      statuses: [{ err: { InstructionError: [2, { Custom: 1 }] } }],
    });

    expect(await sendAndConfirm(ctx, draft, [signer])).toEqual({
      ok: false,
      code: "TRANSACTION_REJECTED",
      landed: "yes",
      signature: ANY_SIGNATURE,
      detail: '{"InstructionError":[2,{"Custom":1}]}',
    });
  });

  it("maps what preflight refused, with the signature of what never left", async () => {
    captureLogs();
    const { ctx, draft, signer } = harness({
      sendThrows: [
        new SendTransactionError({
          action: "simulate",
          signature: "",
          transactionMessage:
            "Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1",
          logs: ["Program 11111111111111111111111111111111 failed: custom program error: 0x1"],
        }),
      ],
    });

    expect(await sendAndConfirm(ctx, draft, [signer])).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_FUNDS",
      landed: "no",
      signature: ANY_SIGNATURE,
    });
  });

  it("does not know whether a broadcast the RPC never answered landed", async () => {
    captureLogs();
    const { ctx, draft, signer } = harness({
      sendThrows: [new RpcUnavailableError("The RPC did not answer")],
    });

    expect(await sendAndConfirm(ctx, draft, [signer])).toEqual({
      ok: false,
      code: "RPC_UNAVAILABLE",
      landed: "unknown",
      signature: ANY_SIGNATURE,
    });
  });

  it("writes no key in the logs, whatever fails", async () => {
    const lines = captureLogs();
    const { ctx, draft, signer, secretKeyBase58 } = harness({
      simulationError: "AccountNotFound",
      throws: { getRecentPrioritizationFees: new RpcUnavailableError("The RPC answered 503") },
    });

    await sendAndConfirm(ctx, draft, [signer]);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(secretKeyBase58);
      expect(line).not.toContain(secretKeyBase58.slice(0, 20));
    }
  });

  it("nests the vault signers and accepts an ephemeral one", async () => {
    const { ctx, signer, address: payer, of, sent } = harness();
    const second = Keypair.generate();

    const result = await sendAndConfirm(ctx, signedBy(payer, second.publicKey), [
      signer,
      { kind: "ephemeral", signer: second },
    ]);

    expect(result).toMatchObject({ ok: true });
    // Two signatures paid for, and both of them on the transaction.
    expect(result.ok && result.feeLamports).toBe(10_001n);
    expect(VersionedTransaction.deserialize(sent[0]!).signatures).toHaveLength(2);
    expect(of("withSigner")).toHaveLength(1);
  });

  it("keeps the lookup tables of the draft out of the static keys (V2)", async () => {
    const { ctx, signer, address: payer, sent } = harness();
    const listed = Keypair.generate().publicKey;
    const draft: TxDraft = {
      feePayer: payer,
      instructions: [
        new TransactionInstruction({
          programId: MEMO_PROGRAM,
          keys: [{ pubkey: listed, isSigner: false, isWritable: false }],
          data: Buffer.from("hi"),
        }),
      ],
      lookupTables: [
        new AddressLookupTableAccount({
          key: Keypair.generate().publicKey,
          state: {
            deactivationSlot: 2n ** 64n - 1n,
            lastExtendedSlot: 0,
            lastExtendedSlotStartIndex: 0,
            addresses: [listed],
          },
        }),
      ],
    };

    expect(await sendAndConfirm(ctx, draft, [signer])).toMatchObject({ ok: true });
    const { message } = VersionedTransaction.deserialize(sent[0]!);
    expect(message.addressTableLookups).toHaveLength(1);
    expect(message.staticAccountKeys.map((key) => key.toBase58())).not.toContain(listed.toBase58());
  });

  it("refuses to send a transaction a signer is missing for", async () => {
    const { ctx, signer, address: payer } = harness();
    const second = Keypair.generate();

    await expect(sendAndConfirm(ctx, signedBy(payer, second.publicKey), [signer])).rejects.toThrow(
      `No signer for ${second.publicKey.toBase58()}`,
    );
  });

  it("uses the estimate of the caller for the first attempt", async () => {
    const { ctx, draft, signer, of } = harness();
    const fee: FeeEstimate = {
      microLamportsPerCu: 5n,
      computeUnitLimit: 600,
      baseFeeLamports: 5_000n,
      priorityFeeLamports: 1n,
      totalFeeLamports: 5_001n,
    };

    const result = await sendAndConfirm(ctx, draft, [signer], { fee });

    expect(result).toMatchObject({ ok: true, feeLamports: 5_001n });
    expect(of("simulateTransaction")).toHaveLength(0);
    expect(of("getRecentPrioritizationFees")).toHaveLength(0);
  });
});
