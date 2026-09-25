import type { Duration, Plan } from "../constants.js";
import { formatDateTime } from "../format/date.js";
import { formatSolExact, withUsd } from "../format/sol.js";
import { shortAddress } from "../format/text.js";
import { en } from "../i18n/en.js";
import { invoiceSol } from "../subscription/amounts.js";
import type { DepositCase } from "../subscription/deposits.js";
import type { PaymentStatus } from "../subscription/invoice.js";
import { a, code, escapeHtml } from "../ui/html.js";
import type { Ui } from "../ui/index.js";
import { renderScreen } from "../ui/screen.js";
import type { Screen } from "../ui/screen.js";

// The messages of V1-33 to the admins (§11.4): what the worker moved from a deposit address
// to the treasury, and what they must refund or check by hand. Plain HTML, no button.

export type AlertInvoice = {
  plan: Plan;
  duration: Duration;
  createdAt: Date;
  /** `59.00`, frozen on the invoice. */
  priceUsd: string;
  expectedLamports: bigint;
  depositAddress: string;
  status: Exclude<PaymentStatus, "PENDING">;
};

/** `null`: the account was purged (§13), the invoice stays detached. */
type AlertUser = { telegramId: bigint; username: string | null } | null;

export type DepositAlert =
  | {
      kind: Exclude<DepositCase, "PAID">;
      invoice: AlertInvoice;
      user: AlertUser;
      /** What sat on the deposit when it was moved. */
      balanceLamports: bigint;
      movedLamports: bigint;
      signature: string;
      /** The sender of the last deposit, when the chain says it (proposal). */
      from?: string;
    }
  | {
      kind: "SWEEP_FAILED";
      invoice: AlertInvoice;
      user: AlertUser;
      /** `null`: the balance could not be read either. */
      balanceLamports: bigint | null;
      /** A code and a short detail of V1-13, never a secret. */
      reason: string;
      /** `null`: found unmoved when its key was due to go, not after a run of retries. */
      attempts: number | null;
    };

const texts = en.admin.depositAlert;

const userText = (user: AlertUser): string => {
  if (user === null) return texts.deletedAccount;
  const id = user.telegramId.toString();
  return user.username === null
    ? texts.userId(id)
    : texts.userWithName(escapeHtml(user.username), id);
};

const TITLES: Record<DepositAlert["kind"], string> = {
  PARTIAL_EXPIRED: texts.manualRefund,
  LATE_FULL_PAYMENT: texts.manualRefund,
  OLD_ADDRESS: texts.oldAddress,
  SWEEP_FAILED: texts.sweepFailed,
};

/**
 * One alert (§8.3, V1-33), without a button. Amounts are exact to the lamport, unlike the 4
 * decimals of the invoice: an admin refunds them by hand. The expected amount is the one the
 * invoice showed.
 */
export function buildDepositAlert(ui: Ui, alert: DepositAlert): Screen {
  const { invoice } = alert;
  const deposit = texts.deposit(
    a(shortAddress(invoice.depositAddress), ui.explorerAddressUrl(invoice.depositAddress)),
    code(invoice.depositAddress),
  );
  const head = [
    texts.invoice(
      en.plans[invoice.plan],
      en.durations[invoice.duration],
      formatDateTime(invoice.createdAt),
    ),
    texts.user(userText(alert.user)),
  ];

  const lines =
    alert.kind === "SWEEP_FAILED"
      ? [
          ...head,
          deposit,
          texts.balance(
            alert.balanceLamports === null ? en.common.none : formatSolExact(alert.balanceLamports),
          ),
          texts.reason(escapeHtml(alert.reason)),
        ]
      : [
          ...head,
          alert.kind === "OLD_ADDRESS" && texts.status(texts.statuses[invoice.status]),
          texts.expected(withUsd(invoiceSol(invoice.expectedLamports), Number(invoice.priceUsd))),
          texts.received(formatSolExact(alert.balanceLamports)),
          en.admin.common.movedToTreasury(formatSolExact(alert.movedLamports)),
          deposit,
          alert.from !== undefined &&
            texts.from(a(shortAddress(alert.from), ui.explorerAddressUrl(alert.from))),
          texts.tx(a(shortAddress(alert.signature), ui.explorerTxUrl(alert.signature))),
        ];

  return renderScreen({
    header: ui.screenHeader(TITLES[alert.kind]),
    description:
      alert.kind === "SWEEP_FAILED" ? texts.SWEEP_FAILED(alert.attempts) : texts[alert.kind],
    info: lines.filter((line): line is string => typeof line === "string"),
    keyboard: [],
  });
}
