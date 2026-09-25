export const SOLANA_CLUSTERS = ["devnet", "testnet", "mainnet-beta"] as const;
export type SolanaCluster = (typeof SOLANA_CLUSTERS)[number];

/**
 * What the code needs of a cluster. Nothing here is shown to a user: since D24 (25/09/2026) no
 * screen names the network, neither as a badge nor in a text.
 */
export type ClusterConfig = {
  /** Value of the `?cluster=` parameter of explorer.solana.com, without which a link opens mainnet. */
  explorerCluster: string;
  /** Checked at startup against the RPC endpoint (V1-04). */
  genesisHash: string;
};

// Single place where a cluster is described (D8). V1 is devnet only: the mainnet entry
// comes with DEC-05.
const CLUSTER_CONFIGS: Partial<Record<SolanaCluster, ClusterConfig>> = {
  devnet: {
    explorerCluster: "devnet",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  },
};

export class UnsupportedClusterError extends Error {
  constructor(cluster: string) {
    super(`Cluster "${cluster}" is not supported: V1 runs on devnet only`);
    this.name = "UnsupportedClusterError";
  }
}

export function getClusterConfig(cluster: SolanaCluster): ClusterConfig {
  const config = CLUSTER_CONFIGS[cluster];
  if (config === undefined) throw new UnsupportedClusterError(cluster);
  return config;
}

const explorerUrl = (kind: "address" | "tx", id: string, cluster: SolanaCluster): string =>
  `https://explorer.solana.com/${kind}/${encodeURIComponent(id)}?cluster=${getClusterConfig(cluster).explorerCluster}`;

export const explorerAddressUrl = (address: string, cluster: SolanaCluster): string =>
  explorerUrl("address", address, cluster);

export const explorerTxUrl = (signature: string, cluster: SolanaCluster): string =>
  explorerUrl("tx", signature, cluster);
