import { en } from "../i18n/en.js";
import type { Ui } from "../ui/index.js";
import { renderScreen } from "../ui/screen.js";
import type { Screen } from "../ui/screen.js";
import { sweptTransferLines } from "./swept-transfers.js";
import type { SweptTransfer } from "./swept-transfers.js";
import { adminUserText } from "./user.js";
import type { AdminUser } from "./user.js";

export type InactiveRefundAlert = { user: AdminUser; transfers: SweptTransfer[] };

/**
 * ⚠️ MANUAL REFUND (V1-45): the SOL of an account went to the treasury, then its user came back
 * before the deletion, so the account was kept with empty wallets. The template of the alerts of
 * V1-33: exact amounts, an admin refunds them by hand.
 */
export function buildInactiveRefundAlert(ui: Ui, alert: InactiveRefundAlert): Screen {
  const texts = en.admin.inactiveRefund;
  return renderScreen({
    header: ui.screenHeader(en.admin.depositAlert.manualRefund),
    description: texts.description,
    info: [texts.user(adminUserText(alert.user)), ...sweptTransferLines(ui, alert.transfers)],
    keyboard: [],
  });
}
