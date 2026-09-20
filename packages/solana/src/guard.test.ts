import { describe, expect, it, vi } from "vitest";
import { assertDevnet, DevnetGuardError, rpcHost } from "./guard.js";

const DEVNET_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const RPC = "https://api.devnet.solana.com";

describe("assertDevnet", () => {
  it("accepts a devnet RPC", async () => {
    const getGenesisHash = vi.fn().mockResolvedValue(DEVNET_HASH);

    await expect(
      assertDevnet({ cluster: "devnet", rpcUrl: RPC, getGenesisHash }),
    ).resolves.toBeUndefined();
    expect(getGenesisHash).toHaveBeenCalledWith(RPC);
  });

  it.each(["mainnet-beta", "testnet", "localnet", ""])(
    "refuses the cluster %j",
    async (cluster) => {
      const getGenesisHash = vi.fn().mockResolvedValue(DEVNET_HASH);

      await expect(assertDevnet({ cluster, rpcUrl: RPC, getGenesisHash })).rejects.toThrow(
        /SOLANA_CLUSTER must be "devnet"/,
      );
      // The cluster is wrong: no point asking the RPC.
      expect(getGenesisHash).not.toHaveBeenCalled();
    },
  );

  it("refuses an RPC whose genesis hash is not devnet", async () => {
    const mainnetHash = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

    await expect(
      assertDevnet({
        cluster: "devnet",
        rpcUrl: RPC,
        getGenesisHash: () => Promise.resolve(mainnetHash),
      }),
    ).rejects.toThrow(/not a devnet RPC/);
  });

  it("fails closed when the RPC cannot be reached", async () => {
    await expect(
      assertDevnet({
        cluster: "devnet",
        rpcUrl: RPC,
        getGenesisHash: () => Promise.reject(new Error("ECONNREFUSED")),
      }),
    ).rejects.toThrow(/cannot reach SOLANA_RPC_URL/);
  });

  it("fails closed when the RPC does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const guard = assertDevnet({
        cluster: "devnet",
        rpcUrl: RPC,
        timeoutMs: 10_000,
        getGenesisHash: () => new Promise(() => undefined),
      });
      const assertion = expect(guard).rejects.toThrow(/cannot reach SOLANA_RPC_URL/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("always throws DevnetGuardError, never the underlying error", async () => {
    await expect(
      assertDevnet({
        cluster: "devnet",
        rpcUrl: RPC,
        getGenesisHash: () => Promise.reject(new Error("rpc-secret-key leaked here")),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DevnetGuardError && !error.message.includes("rpc-secret-key"),
    );
  });
});

describe("rpcHost", () => {
  it("keeps the host only: a query string can hold an API key", () => {
    expect(rpcHost("https://rpc.example.com/v1?api-key=secret-value")).toBe("rpc.example.com");
    expect(rpcHost("http://localhost:8899")).toBe("localhost:8899");
    expect(rpcHost("not a url")).toBe("<invalid URL>");
  });
});
