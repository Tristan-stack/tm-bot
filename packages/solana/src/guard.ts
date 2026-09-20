import { getClusterConfig, SECOND_MS } from "@launchbot/shared";
import { Connection } from "@solana/web3.js";

/** §15: the bot refuses to start if the RPC does not point at devnet. */
export class DevnetGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevnetGuardError";
  }
}

export type DevnetGuardParams = {
  cluster: string;
  rpcUrl: string;
  timeoutMs?: number;
  /** Test seam: reads the genesis hash of the endpoint. */
  getGenesisHash?: (rpcUrl: string) => Promise<string>;
};

/** Proposal. */
const DEFAULT_TIMEOUT_MS = 10 * SECOND_MS;

const readGenesisHash = (rpcUrl: string): Promise<string> =>
  new Connection(rpcUrl, "confirmed").getGenesisHash();

/** Only the host is exposed: the query string of an RPC URL can hold an API key. */
export function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return "<invalid URL>";
  }
}

/**
 * Fails closed: an unreachable RPC refuses the start just like a mainnet one. No environment
 * variable and no test switch can skip this check.
 */
export async function assertDevnet(params: DevnetGuardParams): Promise<void> {
  const {
    cluster,
    rpcUrl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    getGenesisHash = readGenesisHash,
  } = params;
  if (cluster !== "devnet") {
    throw new DevnetGuardError('Refusing to start: SOLANA_CLUSTER must be "devnet".');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });

  let genesisHash: string;
  try {
    genesisHash = await Promise.race([getGenesisHash(rpcUrl), timeout]);
  } catch {
    // The cause is dropped on purpose: an RPC error can quote the URL and its API key.
    throw new DevnetGuardError(
      "Refusing to start: cannot reach SOLANA_RPC_URL to verify the cluster.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (genesisHash !== getClusterConfig("devnet").genesisHash) {
    throw new DevnetGuardError(
      "Refusing to start: SOLANA_RPC_URL is not a devnet RPC (unexpected genesis hash).",
    );
  }
}
