import { ComputeBudgetProgram, SendTransactionError, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { RpcUnavailableError } from "../rpc.js";
import { describeError, failureOfThrown, failureOfTransactionError } from "./errors.js";

const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();
const SYSTEM = SystemProgram.programId.toBase58();
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** The programs of a compiled transfer: the Compute Budget pair, then the System program. */
const TRANSFER = [COMPUTE_BUDGET, COMPUTE_BUDGET, SYSTEM];

describe("describeError", () => {
  it("keeps a string as it is and serializes an object", () => {
    expect(describeError("AccountNotFound")).toBe("AccountNotFound");
    expect(describeError({ InstructionError: [2, { Custom: 1 }] })).toBe(
      '{"InstructionError":[2,{"Custom":1}]}',
    );
  });

  it("has nothing to say about nothing", () => {
    expect(describeError(null)).toBeUndefined();
    expect(describeError(undefined)).toBeUndefined();
    expect(describeError("")).toBeUndefined();
  });

  it("never carries a body: 120 characters at most", () => {
    const detail = describeError("x".repeat(500));

    expect(detail).toHaveLength(121);
    expect(detail?.endsWith("…")).toBe(true);
  });
});

describe("failureOfTransactionError", () => {
  const code = (err: unknown, programs: readonly string[] = TRANSFER) =>
    failureOfTransactionError(err, "no", programs).code;

  it("maps what the runtime says about missing funds", () => {
    expect(code("AccountNotFound")).toBe("INSUFFICIENT_FUNDS");
    expect(code("InsufficientFundsForFee")).toBe("INSUFFICIENT_FUNDS");
  });

  it("reads a custom code by the program of its instruction, in both shapes", () => {
    expect(code({ InstructionError: [2, { Custom: 1 }] })).toBe("INSUFFICIENT_FUNDS");
    expect(code("Error processing Instruction 2: custom program error: 0x1")).toBe(
      "INSUFFICIENT_FUNDS",
    );
    // The same code from another program means something else: a rejection, not a guess.
    expect(code({ InstructionError: [2, { Custom: 1 }] }, [COMPUTE_BUDGET, COMPUTE_BUDGET, MEMO])) //
      .toBe("TRANSACTION_REJECTED");
    expect(code({ InstructionError: [2, { Custom: 6 }] })).toBe("TRANSACTION_REJECTED");
    expect(code({ InstructionError: [2, { Custom: 1 }] }, [])).toBe("TRANSACTION_REJECTED");
  });

  it("tells the rent of the payer from the rent of the destination", () => {
    expect(code({ InsufficientFundsForRent: { account_index: 0 } })).toBe("REMAINING_BELOW_RENT");
    expect(code({ InsufficientFundsForRent: { account_index: 1 } })).toBe("DESTINATION_BELOW_RENT");
    expect(code("Transaction results in an account (1) with insufficient funds for rent")).toBe(
      "DESTINATION_BELOW_RENT",
    );
  });

  it("maps an expired blockhash", () => {
    expect(code("BlockhashNotFound")).toBe("BLOCKHASH_EXPIRED");
    expect(code("Blockhash not found")).toBe("BLOCKHASH_EXPIRED");
  });

  it("refuses to guess: anything else is a rejection, with its detail", () => {
    expect(failureOfTransactionError({ InstructionError: [0, "ProgramFailedToComplete"] }, "yes")) //
      .toEqual({
        ok: false,
        code: "TRANSACTION_REJECTED",
        landed: "yes",
        detail: '{"InstructionError":[0,"ProgramFailedToComplete"]}',
      });
  });
});

describe("failureOfThrown", () => {
  it("is the RPC being down, with the landed the caller knows", () => {
    const down = new RpcUnavailableError("The RPC did not answer");

    expect(failureOfThrown(down, "unknown", TRANSFER)).toEqual({
      ok: false,
      code: "RPC_UNAVAILABLE",
      landed: "unknown",
    });
    expect(failureOfThrown(down, "no", TRANSFER).landed).toBe("no");
  });

  it("reads the message of a broadcast that preflight refused: nothing left", () => {
    const refused = new SendTransactionError({
      action: "simulate",
      signature: "",
      transactionMessage:
        "Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1",
      logs: ["Program 11111111111111111111111111111111 failed: custom program error: 0x1"],
    });

    expect(failureOfThrown(refused, "unknown", TRANSFER)).toMatchObject({
      code: "INSUFFICIENT_FUNDS",
      landed: "no",
    });
  });

  it("reads any other error as an answer of the RPC", () => {
    expect(
      failureOfThrown(
        new Error("failed to simulate transaction: Blockhash not found"),
        "no",
        TRANSFER,
      ),
    ) //
      .toMatchObject({ code: "BLOCKHASH_EXPIRED", landed: "no" });
  });
});
