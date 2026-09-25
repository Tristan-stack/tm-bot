import { formatSolExact } from "../format/sol.js";
import { shortAddress } from "../format/text.js";
import { en } from "../i18n/en.js";
import { a, escapeHtml } from "../ui/html.js";
import type { Ui } from "../ui/index.js";

/** One transfer of an account to the treasury, confirmed on the chain (V1-44, V1-45). */
export type SweptTransfer = {
  walletName: string;
  fromAddress: string;
  lamports: bigint;
  signature: string;
};

/**
 * `Moved to treasury: 2.4999 SOL`, then a line per transfer with its wallet, its address and
 * its transaction as explorer links: the exact amounts an admin refunds (V1-44, V1-45).
 */
export function sweptTransferLines(ui: Ui, transfers: SweptTransfer[]): string[] {
  const texts = en.admin.common;
  const moved = transfers.reduce((total, transfer) => total + transfer.lamports, 0n);
  return [
    texts.movedToTreasury(formatSolExact(moved)),
    ...transfers.map((transfer) =>
      texts.sweptTransfer(
        escapeHtml(transfer.walletName),
        a(shortAddress(transfer.fromAddress), ui.explorerAddressUrl(transfer.fromAddress)),
        formatSolExact(transfer.lamports),
        a(shortAddress(transfer.signature), ui.explorerTxUrl(transfer.signature)),
      ),
    ),
  ];
}
