import type { DeletionBlocker, DeletionCounts, OpenInvoice, PurgeSummary } from "@launchbot/db";
import {
  adminUserName,
  cbBtn,
  code,
  en,
  escapeHtml,
  formatDateTime,
  formatSol,
  formatSolAmount,
  formatTimeUtc,
  invoiceSol,
  planLabel,
  renderScreen,
  shortAddress,
  sweptTransferLines,
  tree,
} from "@launchbot/shared";
import type { OptionalLine, Screen, SweptTransfer, Ui } from "@launchbot/shared";
import { ADMIN_CB, adminHeader, MENU_ROW, offerLabel } from "./common.js";

// /purge (§11.3, §11.4, V1-44): the summary, blocked or not, and the result. Since the decision of
// 25/09/2026 the SOL of the wallets goes to the treasury before the deletion instead of blocking.

const texts = en.admin.purge;

/** A pending invoice ends within its 30 minutes; an ended one is payable 24 h (§8.3). */
function invoiceLine(invoice: OpenInvoice): string {
  const amount = invoiceSol(invoice.expectedLamports);
  return invoice.status === "PENDING"
    ? texts.pendingInvoice(offerLabel(invoice), amount, formatTimeUtc(invoice.expiresAt))
    : texts.payableInvoice(offerLabel(invoice), amount, formatDateTime(invoice.payableUntil));
}

/** The written reason of each blocker (§4.5). */
function blockerFlag(blocker: DeletionBlocker): string {
  switch (blocker.kind) {
    case "PENDING_INVOICE":
      return blocker.status === "PENDING"
        ? texts.pending(offerLabel(blocker))
        : texts.payable(offerLabel(blocker), formatDateTime(blocker.payableUntil));
    case "BALANCES_UNAVAILABLE":
      return texts.balancesUnavailable;
  }
}

/**
 * The summary (§11.4): the account, its wallets with a balance read now, the invoices that
 * could still be paid, then what blocks the purge and what goes to the treasury. Blocked:
 * Cancel only.
 */
export function buildPurgeSummaryScreen(
  ui: Ui,
  model: { summary: PurgeSummary; now: Date },
): Screen {
  const { user, plan, wallets, toTreasuryLamports, invoices, blockers } = model.summary;
  const label = planLabel(plan, model.now);
  const flags: OptionalLine[] = [
    ...blockers.map(blockerFlag),
    // Not blockers: the SOL goes to the treasury, the plan is lost, never refunded (§11.4).
    toTreasuryLamports > 0n && texts.toTreasury(formatSolAmount(toTreasuryLamports)),
    plan.kind === "ACTIVE" && texts.subscriptionLost,
  ];
  const cancel = cbBtn(en.btn.cancel, ADMIN_CB.purgeCancel);
  return renderScreen({
    header: adminHeader(ui, "purge"),
    description: texts.description,
    info: [
      tree(texts.user, [
        adminUserName(user) ?? en.common.none,
        en.home.id(code(user.telegramId.toString())),
        label === null ? en.home.noSubscription : en.home.subscription(label),
      ]),
      tree(
        texts.wallets,
        wallets.length === 0
          ? [texts.noWallet]
          : wallets.map((wallet) =>
              texts.wallet(
                escapeHtml(wallet.name),
                shortAddress(wallet.publicKey),
                wallet.lamports === null ? en.wallets.unavailableSol : formatSol(wallet.lamports),
              ),
            ),
      ),
      tree(texts.invoices, invoices.length === 0 ? [texts.noInvoice] : invoices.map(invoiceLine)),
    ].join("\n\n"),
    flags,
    keyboard:
      blockers.length > 0
        ? [[cancel]]
        : [[cbBtn(texts.btnConfirm, ADMIN_CB.purgeConfirm(user.telegramId)), cancel]],
  });
}

/** The transfers of the purge, under what the screen says: nothing when none was needed. */
const transfersBlock = (ui: Ui, transfers: SweptTransfer[]): string[] =>
  transfers.length === 0 ? [] : [sweptTransferLines(ui, transfers).join("\n")];

/**
 * Done: what went with the account, what stays detached for the books (§13), and the SOL moved
 * to the treasury before, for a refund by hand.
 */
export function buildPurgeResultScreen(
  ui: Ui,
  model: { counts: DeletionCounts; notified: boolean; transfers: SweptTransfer[] },
): Screen {
  const counts = [texts.deleted(model.counts), texts.detached(model.counts)].join("\n");
  return renderScreen({
    header: adminHeader(ui, "purge"),
    description: texts.done,
    info: [counts, ...transfersBlock(ui, model.transfers)].join("\n\n"),
    flags: [!model.notified && en.admin.common.notNotified],
    keyboard: [MENU_ROW],
  });
}

/**
 * A transfer to the treasury failed or is still unconfirmed: nothing was deleted, every key is
 * kept. The transfers already made are listed; a new /purge moves only what is left.
 */
export function buildPurgeStoppedScreen(ui: Ui, transfers: SweptTransfer[]): Screen {
  return renderScreen({
    header: adminHeader(ui, "purge"),
    description: texts.stopped,
    info: transfersBlock(ui, transfers),
    keyboard: [MENU_ROW],
  });
}
