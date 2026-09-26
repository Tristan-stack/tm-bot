import { explorerAddressUrl, explorerTxUrl, getClusterConfig } from "../cluster.js";
import type { SolanaCluster } from "../cluster.js";
import { flowHeader, screenHeader } from "./header.js";
import type { FlowName } from "./header.js";

export { FLOWS, progressBar } from "./header.js";
export type { FlowName } from "./header.js";
export { a, b, code, escapeHtml, pre } from "./html.js";
export {
  cancelBtn,
  cbBtn,
  navRow,
  renderInputScreen,
  renderScreen,
  ScreenTooLongError,
  tree,
  urlBtn,
  webAppBtn,
} from "./screen.js";
export type { Button, InputScreenParams, OptionalLine, Screen, ScreenParams } from "./screen.js";
export { splitHtmlMessage } from "./split.js";
export type { SplitOptions } from "./split.js";

/**
 * Proposal: shared never reads the environment, so each process binds the cluster-dependent
 * helpers once at startup with `createUi(env.SOLANA_CLUSTER)`: the explorer links. The headers
 * name no network (D24). Throws on an unsupported cluster.
 */
export function createUi(cluster: SolanaCluster) {
  getClusterConfig(cluster);
  return {
    screenHeader: (title: string, counter?: string) => screenHeader(title, counter),
    flowHeader: ({ flow, step }: { flow: FlowName; step: number }) => flowHeader(flow, step),
    explorerAddressUrl: (address: string) => explorerAddressUrl(address, cluster),
    explorerTxUrl: (signature: string) => explorerTxUrl(signature, cluster),
  };
}

export type Ui = ReturnType<typeof createUi>;
