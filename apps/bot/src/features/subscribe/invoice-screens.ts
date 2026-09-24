import type { InvoiceView } from "@launchbot/db";
import {
  cbBtn,
  code,
  en,
  formatClock,
  formatSol,
  formatTimeUtc,
  INVOICE_TTL_MS,
  MINUTE_MS,
  renderScreen,
  withUsd,
} from "@launchbot/shared";
import type { OptionalLine, Screen, Ui } from "@launchbot/shared";
import { offerHeader, SUB_CB } from "./screens.js";

const { invoice: texts } = en.subscribe;

/**
 * An amount of an invoice (§8.3): 4 decimals rounded **up**, so « Send exactly » never asks for
 * less than the lamports expected (570 820 434 → `0.5709 SOL`), and what is left to send is
 * never understated. Pay from my wallet (V1-31) shows the same amounts.
 */
export const invoiceSol = (lamports: bigint): string =>
  formatSol(lamports, { decimals: 4, rounding: "ceil" });

/** What was received: floored, like a balance, never overstated. */
const receivedSol = (lamports: bigint): string => formatSol(lamports, { decimals: 4 });

/**
 * `0.5709 SOL ($59.00)`: an amount with the price of the invoice, never recomputed at the
 * current rate. The price is the one of the whole invoice: a rest shows none (proposal).
 */
export const invoiceAmount = (invoice: InvoiceView, lamports: bigint): string =>
  withUsd(
    invoiceSol(lamports),
    lamports === invoice.expectedLamports ? Number(invoice.priceUsd) : null,
  );

/** `⚠️ Partial payment: …` once something arrived, under the status line (V1-30) or the invoice line (V1-31). */
export const partialLines = (invoice: InvoiceView): string[] =>
  invoice.receivedLamports > 0n
    ? [texts.partial(receivedSol(invoice.receivedLamports), invoiceSol(invoice.remainingLamports))]
    : [];

/**
 * The status line (§8.3, §4.5): waiting with the time left at the render (the message is not
 * edited every second), checked by « I've paid » at a time, or sent from a bot wallet (V1-31).
 */
export type InvoiceLine =
  { kind: "WAITING" } | { kind: "LAST_CHECK"; at: Date } | { kind: "PAYMENT_SENT" };

export type InvoiceModel = { invoice: InvoiceView; line: InvoiceLine; flags?: OptionalLine[] };

const statusLines = ({ invoice, line }: InvoiceModel): string[] => {
  const countdown = formatClock(invoice.secondsLeft);
  switch (line.kind) {
    case "WAITING":
      return [texts.waiting(countdown)];
    case "LAST_CHECK":
      return [texts.lastCheck(formatTimeUtc(line.at)), texts.expiresIn(countdown)];
    case "PAYMENT_SENT":
      return [texts.paymentSent];
  }
};

/** An invoice waiting for its payment (§8.3): the exact amount, the deposit address, the time left. */
export function buildInvoiceScreen(ui: Ui, model: InvoiceModel): Screen {
  const { invoice } = model;
  return renderScreen({
    header: offerHeader(ui, invoice.offer),
    // « Send exactly » keeps the total: a partial payment says the rest on its own line.
    description: [
      texts.sendExactly(invoiceAmount(invoice, invoice.expectedLamports)),
      code(invoice.depositAddress),
    ],
    info: [...statusLines(model), ...partialLines(invoice)],
    flags: model.flags,
    keyboard: [
      [cbBtn(texts.btnPayFromWallet, SUB_CB.payFromWallet(invoice.id))],
      [
        cbBtn(texts.btnPaid, SUB_CB.paid(invoice.id)),
        cbBtn(en.btn.cancel, SUB_CB.cancel(invoice.id)),
      ],
    ],
  });
}

/** How an invoice that can no longer activate ended (§8.3). */
export type InvoiceEnd = "EXPIRED" | "PARTIAL_EXPIRED" | "LATE_FULL_PAYMENT";

/** Shown at the next click on an invoice past its 30 minutes: no edit at the expiry itself. */
export function buildInvoiceExpiredScreen(ui: Ui, invoice: InvoiceView, end: InvoiceEnd): Screen {
  return renderScreen({
    header: offerHeader(ui, invoice.offer),
    description: [texts.expired, texts.expiredNote(INVOICE_TTL_MS / MINUTE_MS)],
    flags: [
      end === "PARTIAL_EXPIRED" && texts.partialExpired(receivedSol(invoice.receivedLamports)),
      end === "LATE_FULL_PAYMENT" && texts.latePayment,
    ],
    keyboard: [
      [cbBtn(texts.btnNewInvoice, SUB_CB.renew(invoice.id)), cbBtn(en.btn.back, SUB_CB.open)],
    ],
  });
}
