import { describe, expect, it } from "vitest";
import { RpcUnavailableError } from "../rpc.js";
import { lookupSignature } from "./status.js";
import { fakeRpc } from "./test-rpc.js";

describe("lookupSignature", () => {
  it("reads the history: a confirmed transaction, with its slot", async () => {
    const { rpc, calls } = fakeRpc({
      historyStatus: { slot: 99, confirmationStatus: "confirmed" },
    });

    expect(await lookupSignature(rpc, "sig")).toEqual({ status: "confirmed", slot: 99 });
    expect(calls).toEqual([{ method: "getSignatureStatuses", history: true }]);
  });

  it("tells a transaction that landed and failed", async () => {
    const { rpc } = fakeRpc({
      historyStatus: { slot: 7, err: { InstructionError: [2, { Custom: 1 }] } },
    });

    expect(await lookupSignature(rpc, "sig")).toEqual({
      status: "failed",
      slot: 7,
      detail: '{"InstructionError":[2,{"Custom":1}]}',
    });
  });

  it("tells a block still being voted on from a transaction the cluster never saw", async () => {
    expect(await lookupSignature(fakeRpc({ historyStatus: null }).rpc, "sig")).toEqual({
      status: "not_found",
    });
    expect(
      await lookupSignature(
        fakeRpc({ historyStatus: { slot: 3, confirmationStatus: "processed" } }).rpc,
        "sig",
      ),
    ).toEqual({ status: "processed", slot: 3 });
  });

  it("says when the RPC could not answer, and lets any other error out", async () => {
    const down = fakeRpc({
      throws: { getSignatureStatuses: new RpcUnavailableError("The RPC did not answer") },
    });
    const broken = fakeRpc({ throws: { getSignatureStatuses: new Error("bad signature") } });

    expect(await lookupSignature(down.rpc, "sig")).toEqual({ status: "unavailable" });
    await expect(lookupSignature(broken.rpc, "sig")).rejects.toThrow("bad signature");
  });
});
