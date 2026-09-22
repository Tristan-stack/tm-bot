import { SECOND_MS } from "@launchbot/shared";
import { Connection } from "@solana/web3.js";

/** Proposal. The bot handles one update at a time: an RPC that hangs would stall every user. */
const RPC_TIMEOUT_MS = 5 * SECOND_MS;

let cached: { rpcUrl: string; connection: Connection } | undefined;

/**
 * The RPC connection of the process, on `env.SOLANA_RPC_URL`: the endpoint the devnet guard
 * verified is the one every read uses. Never log the URL of a connection: a paid RPC carries
 * its API key in the query string (`rpcHost` gives the host).
 *
 * Proposal: `confirmed`, as §8.3 asks for payments; `finalized` would show a deposit about
 * 13 s later.
 */
export function getSolanaRpc(rpcUrl: string): Connection {
  if (cached?.rpcUrl !== rpcUrl) {
    const connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      // web3.js would otherwise sleep and retry a 429 five times, about 7.5 s, behind our back.
      disableRetryOnRateLimit: true,
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }),
    });
    cached = { rpcUrl, connection };
  }
  return cached.connection;
}
