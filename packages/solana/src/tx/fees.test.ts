import { getWithdrawFeeBudgetLamports, MAX_COMPUTE_UNITS } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it } from "vitest";
import { RpcUnavailableError } from "../rpc.js";
import { estimateFees, feeEstimateOf, isTxFailure } from "./fees.js";
import { address, budgetOf, fakeRpc, TEST_BOUNDS, testContext } from "./test-rpc.js";
import { transferDraft } from "./transfer.js";

const draft = () => transferDraft(address(), address(), 1_000n);

afterEach(() => {
  setLogDestination(undefined);
});

describe("feeEstimateOf", () => {
  it("charges one base fee per signature", () => {
    expect(feeEstimateOf(0n, 540, 1).baseFeeLamports).toBe(5_000n);
    expect(feeEstimateOf(0n, 540, 3).baseFeeLamports).toBe(15_000n);
  });

  it("rounds the priority fee up: 540 units at 1 000 µL cost one lamport", () => {
    const fee = feeEstimateOf(1_000n, 540, 1);

    expect(fee.priorityFeeLamports).toBe(1n);
    expect(fee.totalFeeLamports).toBe(5_001n);
  });

  it("counts the priority fee once, on the limit it asks for", () => {
    const fee = feeEstimateOf(1_000_000n, 540, 1);

    expect(fee.priorityFeeLamports).toBe(540n);
    expect(fee.totalFeeLamports).toBe(fee.baseFeeLamports + fee.priorityFeeLamports);
  });

  it("stays under the withdrawal fee budget of V1-11, at the ceiling of the bounds", () => {
    // The budget is what the Delete screen of V1-11 refuses to leave behind.
    const real = feeEstimateOf(1_000_000n, 540, 1).totalFeeLamports;

    expect(real).toBeLessThanOrEqual(getWithdrawFeeBudgetLamports(1_000_000));
  });
});

describe("isTxFailure", () => {
  it("tells a failure from a success and from a value", () => {
    expect(isTxFailure({ ok: false, code: "INVALID_AMOUNT", landed: "no" })).toBe(true);
    expect(isTxFailure({ ok: true, signature: "s", slot: 1, feeLamports: 0n })).toBe(false);
    expect(isTxFailure({ feePayer: address(), instructions: [] })).toBe(false);
  });
});

describe("estimateFees", () => {
  it("asks for the units of the simulation plus the margin", async () => {
    const fake = fakeRpc({ fees: [1_000], unitsConsumed: 450 });

    const fee = await estimateFees(testContext(fake), draft());

    if (isTxFailure(fee)) throw new Error("expected an estimate");
    expect(fee.computeUnitLimit).toBe(540);
    expect(fee.microLamportsPerCu).toBe(1_000n);
    expect(fee.totalFeeLamports).toBe(5_001n);
    // The price and the units together, once each: no fee call of the RPC, no double count.
    expect(fake.methods()).toEqual(["getRecentPrioritizationFees", "simulateTransaction"]);
  });

  it("simulates at the unit ceiling and at the floor of the bounds", async () => {
    const fake = fakeRpc({ fees: [1_000] });

    await estimateFees(testContext(fake, { ...TEST_BOUNDS, minMicroLamports: 500 }), draft());

    // The ceiling, so that our own limit never cuts the run short; the floor, so that this
    // ceiling does not turn into a fee the real transaction will never pay.
    expect(budgetOf(fake.simulated[0]!)).toEqual({
      computeUnitLimit: MAX_COMPUTE_UNITS,
      microLamportsPerCu: 500n,
    });
  });

  it("never asks for more than the program allows", async () => {
    const fake = fakeRpc({ unitsConsumed: 2_000_000 });

    const fee = await estimateFees(testContext(fake), draft());

    if (isTxFailure(fee)) throw new Error("expected an estimate");
    expect(fee.computeUnitLimit).toBe(MAX_COMPUTE_UNITS);
  });

  it("refuses a simulation that reports no unit count, rather than guess", async () => {
    const fake = fakeRpc({ unitsConsumed: undefined });

    await expect(estimateFees(testContext(fake), draft())).rejects.toThrow("unitsConsumed");
  });

  it("returns the failure of a simulation that errored, and sends nothing", async () => {
    captureLogs();
    const fake = fakeRpc({
      simulationError: { InstructionError: [2, "InvalidAccountData"] },
      simulationLogs: ["Program 11111111111111111111111111111111 failed"],
    });

    const fee = await estimateFees(testContext(fake), draft());

    expect(fee).toEqual({
      ok: false,
      code: "TRANSACTION_REJECTED",
      landed: "no",
      detail: '{"InstructionError":[2,"InvalidAccountData"]}',
    });
    expect(fake.of("sendRawTransaction")).toHaveLength(0);
  });

  it("says the RPC is down when the simulation call gets no answer", async () => {
    const fake = fakeRpc({
      throws: { simulateTransaction: new RpcUnavailableError("The RPC did not answer") },
    });

    expect(await estimateFees(testContext(fake), draft())).toEqual({
      ok: false,
      code: "RPC_UNAVAILABLE",
      landed: "no",
    });
  });
});
