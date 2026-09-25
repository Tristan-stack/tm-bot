import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcUnavailableError } from "../rpc.js";
import { sendAndConfirm } from "./send.js";
import { address, fakeRpc, milliSol, testContext, vaultSigner } from "./test-rpc.js";
import type { FakeRpcState, RpcCall } from "./test-rpc.js";
import { transferDraft } from "./transfer.js";

// §14, V1-46: the signing path every transfer of V1 takes — a withdrawal (V1-14), a payment
// from a wallet (V1-31), a sweep to the treasury (V1-33, V1-44, V1-45) — writes no key in the
// logs, at debug, when the key is really decrypted and used, and when a send goes wrong.
vi.hoisted(() => {
  process.env["LOG_LEVEL"] = "debug";
});

afterEach(() => {
  setLogDestination(undefined);
});

const SCRIPTS: [string, Partial<FakeRpcState>][] = [
  ["confirmed at once", { statuses: [{ confirmationStatus: "confirmed" }] }],
  [
    "sent again, the second broadcast refused",
    {
      statuses: [null, { confirmationStatus: "confirmed" }],
      heights: [200],
      sendThrows: [null, new Error("Transaction simulation failed: already processed")],
    },
  ],
  ["signed again after an expired blockhash", { statuses: [null], heights: [201] }],
  ["landed and failed", { statuses: [{ err: { InstructionError: [2, { Custom: 1 }] } }] }],
  [
    "the RPC gone during the confirmation",
    { throws: { getSignatureStatuses: new RpcUnavailableError("The RPC did not answer") } },
  ],
  [
    "no priority fee and a refused simulation",
    {
      simulationError: "AccountNotFound",
      throws: { getRecentPrioritizationFees: new RpcUnavailableError("The RPC answered 503") },
    },
  ],
];

describe("no key in the logs of a transfer (§14, V1-46)", () => {
  it.each(SCRIPTS)("%s", async (_name, script) => {
    const lines = captureLogs();
    const calls: RpcCall[] = [];
    const wallet = vaultSigner(calls);
    const fake = fakeRpc({ fees: [1_000], lastValidBlockHeight: 200, ...script }, calls);

    await sendAndConfirm(testContext(fake), transferDraft(wallet.address, address(), milliSol), [
      wallet.signer,
    ]);

    const written = lines.join("");
    expect(written).not.toContain(wallet.secretKeyBase58);
    expect(written).not.toContain(wallet.secretKeyBase58.slice(0, 20));
    expect(written).not.toMatch(/encSecretKey|authTag/);
  });

  it("really decrypts and signs in these scripts, and logs them at debug", async () => {
    const lines = captureLogs();
    const calls: RpcCall[] = [];
    const wallet = vaultSigner(calls);
    const fake = fakeRpc(
      {
        fees: [1_000],
        statuses: [null, { confirmationStatus: "confirmed" }],
        heights: [200],
        lastValidBlockHeight: 200,
        sendThrows: [null, new Error("already processed")],
      },
      calls,
    );

    await sendAndConfirm(testContext(fake), transferDraft(wallet.address, address(), milliSol), [
      wallet.signer,
    ]);

    expect(fake.of("withSigner")).toHaveLength(1);
    expect(fake.sent.length).toBeGreaterThan(0);
    expect(lines.join("")).toContain('"level":20');
    expect(lines.join("")).not.toContain(wallet.secretKeyBase58);
  });
});
