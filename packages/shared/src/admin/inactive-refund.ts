import { formatSolExact } from "../format/sol.js";
import { shortAddress } from "../format/text.js";
import { en } from "../i18n/en.js";
import { a, escapeHtml } from "../ui/html.js";
import type { Ui } from "../ui/index.js";
import { renderScreen } from "../ui/screen.js";
import type { Screen } from "../ui/screen.js";
import { adminUserText } from "./user.js";
import type { AdminUser } from "./user.js";

/** One transfer of an inactive account to the treasury, confirmed on the chain (V1-45). */
export type SweptTransfer = {
  walletName: string;
  fromAddress: string;
  lamports: bigint;
  signature: string;
};

export type InactiveRefundAlert = { user: AdminUser; transfers: SweptTransfer[] };

/**
 * ⚠️ MANUAL REFUND (V1-45): the SOL of an account went to the treasury, then its user came back
 * before the deletion, so the account was kept with empty wallets. The template of the alerts of
 * V1-33: exact amounts, an admin refunds them by hand.
 */
export function buildInactiveRefundAlert(ui: Ui, alert: InactiveRefundAlert): Screen {
  const texts = en.admin.inactiveRefund;
  const moved = alert.transfers.reduce((total, transfer) => total + transfer.lamports, 0n);
  return renderScreen({
    header: ui.screenHeader(en.admin.depositAlert.manualRefund),
    description: texts.description,
    info: [
      texts.user(adminUserText(alert.user)),
      texts.moved(formatSolExact(moved)),
      ...alert.transfers.map((transfer) =>
        texts.transfer(
          escapeHtml(transfer.walletName),
          a(shortAddress(transfer.fromAddress), ui.explorerAddressUrl(transfer.fromAddress)),
          formatSolExact(transfer.lamports),
          a(shortAddress(transfer.signature), ui.explorerTxUrl(transfer.signature)),
        ),
      ),
    ],
    keyboard: [],
  });
}
