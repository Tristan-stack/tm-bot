import { E } from "./i18n/emoji.js";

export const SOLANA_CLUSTERS = ["devnet", "testnet", "mainnet-beta"] as const;
export type SolanaCluster = (typeof SOLANA_CLUSTERS)[number];

export type ClusterConfig = {
  /** Shown in every screen header. `null` on mainnet: the badge disappears (§4.5). */
  badge: string | null;
  /** Network name outside the badge: withdrawal confirmation, "NEW LAUNCH · Devnet" post. */
  networkName: string;
  /** Value of the `?cluster=` parameter of explorer.solana.com. */
  explorerCluster: string;
  /** Checked at startup against the RPC endpoint (V1-04). */
  genesisHash: string;
};

// Single place where a cluster is described (D8). V1 is devnet only: the mainnet entry
// comes with DEC-05.
const CLUSTER_CONFIGS: Partial<Record<SolanaCluster, ClusterConfig>> = {
  devnet: {
    badge: `${E.devnet} Devnet`,
    networkName: "Devnet",
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
