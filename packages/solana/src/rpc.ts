import { SECOND_MS } from "@launchbot/shared";
import { Connection } from "@solana/web3.js";

/** Proposal. The bot handles one update at a time: an RPC that hangs would stall every user. */
const RPC_TIMEOUT_MS = 5 * SECOND_MS;

/**
 * The RPC gave no answer: a timeout, a network failure, a 429 or a 5xx (V1-13). Classified once,
 * where the transport is, so that no caller has to read the wording of a library. Never a
 * JSON-RPC error, which is an answer. web3.js hands it through untouched for every method the
 * package uses (it wraps a few others, `getBalance` among them, in a string).
 */
export class RpcUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RpcUnavailableError";
  }
}

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
      fetch: async (input, init) => {
        let response: Response;
        try {
          response = await fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
        } catch (error) {
          throw new RpcUnavailableError("The RPC did not answer", { cause: error });
        }
        // web3.js would read the body into a plain `Error` starting with the status code.
        if (response.status === 429 || response.status >= 500) {
          throw new RpcUnavailableError(`The RPC answered ${response.status}`);
        }
        return response;
      },
    });
    cached = { rpcUrl, connection };
  }
  return cached.connection;
}
