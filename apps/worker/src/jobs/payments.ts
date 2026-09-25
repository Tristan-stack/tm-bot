import type { PaymentService } from "@launchbot/db";
import { buildPaymentReceivedScreen } from "@launchbot/shared";
import type { Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { isUndeliverable } from "../telegram.js";
import type { TelegramSender } from "../telegram.js";

const log = createLogger("worker:payments");

export type DetectionDeps = {
  payments: Pick<
    PaymentService,
    "listInvoicesToCheck" | "checkInvoicesBatch" | "expireDueInvoices"
  >;
  /**
   * In order, once per invoice the worker itself activated: « Payment received »
   * (`payments.notify-paid`), then the transfer of its funds (V1-33).
   */
  afterActivation: readonly ((paymentId: string) => Promise<unknown>)[];
  now: () => Date;
};

export type DetectionReport = {
  checked: number;
  activated: number;
  partial: number;
  expired: number;
};

/**
 * One tick of the payment loop (§8.3, V1-32): it only orchestrates V1-28. The balances are read
 * in groups of 100, one call per group, never one per invoice; a group the RPC refuses is
 * checked again next tick. Only the caller that turned an invoice PAID gets `activatedNow`:
 * when « I've paid » (V1-30) or a payment from a wallet (V1-31) won, the bot already showed
 * « Payment received » and nothing is sent here.
 */
export async function detectPayments(deps: DetectionDeps): Promise<DetectionReport> {
  const { payments, afterActivation } = deps;
  const now = deps.now();
  const invoices = await payments.listInvoicesToCheck(now);
  const checks = await payments.checkInvoicesBatch(invoices, now);
  // After the checks: a payment that arrived at 29:59 activates rather than expires.
  const expired = await payments.expireDueInvoices(now);

  const report: DetectionReport = { checked: checks.size, activated: 0, partial: 0, expired };
  for (const [paymentId, check] of checks) {
    if (check.kind === "PARTIAL") report.partial += 1;
    if (check.kind !== "ACTIVATED" || !check.activatedNow) continue;
    report.activated += 1;
    // The activation stands whatever happens to its message or to its transfer.
    for (const step of afterActivation) {
      try {
        await step(paymentId);
      } catch (error) {
        log.error({ err: error, paymentId }, "payment.after_activation_failed");
      }
    }
  }
  return report;
}

export type NotifyPaidDeps = {
  payments: Pick<PaymentService, "getPaidNotice">;
  telegram: Pick<TelegramSender, "sendScreen">;
  ui: Ui;
  now: () => Date;
};

/**
 * `payments.notify-paid` (V1-32): a new message with the screen of V1-30, the plan and its end
 * as they stand now (an extension included). A user who blocked the bot is not retried; a
 * network error, a 5xx or a 429 still there throws, and pg-boss retries.
 */
export async function notifyPaid(deps: NotifyPaidDeps, paymentId: string): Promise<void> {
  const notice = await deps.payments.getPaidNotice(paymentId, deps.now());
  if (notice === null) {
    // A purged account, or a plan over already: nobody to tell.
    log.warn({ paymentId }, "payment.notify_skipped");
    return;
  }
  const result = await deps.telegram.sendScreen(
    notice.telegramId,
    buildPaymentReceivedScreen(deps.ui, notice),
  );
  if (result.ok) {
    log.info({ paymentId, plan: notice.plan }, "payment.notified");
  } else if (!isUndeliverable(result.reason)) {
    throw new Error(`« Payment received » not sent: ${result.reason}`);
  }
}
