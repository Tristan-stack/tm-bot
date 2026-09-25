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
  tree,
} from "@launchbot/shared";
import type { OptionalLine, Screen, Ui } from "@launchbot/shared";
import { ADMIN_CB, adminHeader, MENU_ROW, offerLabel } from "./common.js";

// /purge (§11.3, §11.4, V1-44): the summary, blocked or not, and the result.

const texts = en.admin.purge;

/** A pending invoice ends within its 30 minutes; an ended one is payable 24 h (§8.3). */
function invoiceLine(invoice: OpenInvoice): string {
  const amount = invoiceSol(invoice.expectedLamports);
  return invoice.status === "PENDING"
    ? texts.pendingInvoice(offerLabel(invoice), amount, formatTimeUtc(invoice.expiresAt))
    : texts.payableInvoice(offerLabel(invoice), amount, formatDateTime(invoice.payableUntil));
}

/** The written reason of each blocker (§4.5): the funds flag is the text of the context. */
function blockerFlag(blocker: DeletionBlocker): string {
  switch (blocker.kind) {
    case "WALLET_FUNDS":
      return texts.funds(escapeHtml(blocker.name), formatSolAmount(blocker.lamports));
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
 * could still be paid, then what blocks the purge. Blocked: Cancel only.
 */
export function buildPurgeSummaryScreen(
  ui: Ui,
  model: { summary: PurgeSummary; now: Date },
): Screen {
  const { user, plan, wallets, invoices, blockers } = model.summary;
  const label = planLabel(plan, model.now);
  const flags: OptionalLine[] = [
    ...blockers.map(blockerFlag),
    // Not a blocker (§11.4): lost with the account, never refunded.
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

/** Done: what went with the account, what stays detached for the books (§13). */
export function buildPurgeResultScreen(
  ui: Ui,
  model: { counts: DeletionCounts; notified: boolean },
): Screen {
  return renderScreen({
    header: adminHeader(ui, "purge"),
    description: texts.done,
    info: [texts.deleted(model.counts), texts.detached(model.counts)],
    flags: [!model.notified && en.admin.common.notNotified],
    keyboard: [MENU_ROW],
  });
}
