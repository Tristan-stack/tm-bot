import type { InvoiceView, PayChoice, PayChoices, PayQuote, WalletBalance } from "@launchbot/db";
import {
  cbBtn,
  code,
  en,
  encodeCallback,
  escapeHtml,
  formatSol,
  invoiceSol,
  renderScreen,
  shortAddress,
  tree,
} from "@launchbot/shared";
import type { OptionalLine, Screen, Ui } from "@launchbot/shared";
import type { TxFailure } from "@launchbot/solana";
import { balanceText, WALLET_CB } from "../wallets/screens.js";
import { txFailureText } from "../wallets/withdraw-screens.js";
import { invoiceAmount, partialLines } from "./invoice-screens.js";
import { SUB_CB } from "./screens.js";

/**
 * The steps of Pay from my wallet (V1-31). The invoice and the wallet travel in the data up to
 * the confirmation; Confirm carries the token of its screen (the invoice, the wallet and the
 * amount it showed are in the session), so an older Confirm is a stale button.
 */
export const PAY_CB = {
  wallet: (paymentId: string, walletId: string) =>
    encodeCallback("sub", "pw", "w", paymentId, walletId),
  confirm: (token: string) => encodeCallback("sub", "pw", "ok", token),
  tryAgain: encodeCallback("sub", "pw", "re"),
} as const;

const { payFromWallet: texts } = en.subscribe;
/** The lines a withdrawal shows too (V1-14): the same words for the same transfer. */
const { withdraw } = en.wallets;

/** A wallet balance as the wallets screens show it (3 decimals), without its dollar value. */
const walletSol = (lamports: bigint | null): string => balanceText(lamports, null);

/** Fees up to 6 decimals, rounded up (proposal): 5 000 lamports read `0.000005 SOL`, not `0.000`. */
const feeText = (lamports: bigint): string =>
  formatSol(lamports, { decimals: 6, rounding: "ceil", trim: true, minDecimals: 3 });

/** `⭐ Premium · 2 days · 0.5709 SOL ($59.00)`: the invoice, its total at its own price. */
const invoiceLine = (invoice: InvoiceView): string =>
  texts.invoice(
    en.plans[invoice.offer.plan],
    en.durations[invoice.offer.duration],
    invoiceAmount(invoice, invoice.expectedLamports),
  );

const choiceLine = ({ wallet, missingLamports }: PayChoice): string => {
  const name = escapeHtml(wallet.name);
  const balance = walletSol(wallet.lamports);
  if (missingLamports === null) return texts.walletUnknown(name, balance);
  return missingLamports > 0n
    ? texts.walletShort(name, balance, invoiceSol(missingLamports))
    : texts.walletOk(name, balance);
};

/** The note of a wallet that cannot pay (§4.5, §10.1): how much, and where to send it. */
export const insufficientBlock = (
  invoice: InvoiceView,
  wallet: WalletBalance,
  missingLamports: bigint,
): { alert: string; flag: string } => ({
  alert: texts.insufficient.alert(wallet.name),
  flag: texts.insufficient.note(
    escapeHtml(wallet.name),
    invoiceSol(invoice.remainingLamports),
    invoiceSol(missingLamports),
    code(wallet.publicKey),
  ),
});

/** Step 1 (§8.3): the wallets, oldest first, each with what it lacks; Cancel back to the invoice. */
export function buildPayChoicesScreen(
  ui: Ui,
  choices: PayChoices,
  options: { flags?: OptionalLine[] } = {},
): Screen {
  const { invoice, wallets } = choices;
  const back = SUB_CB.invoice(invoice.id);
  const none = wallets.length === 0;
  const invoiceLines = [invoiceLine(invoice), ...partialLines(invoice)];
  return renderScreen({
    header: ui.screenHeader(texts.title),
    // Without a wallet: the text of §10.1, the way to the wallets and Back.
    description: none ? texts.noWallet : texts.description,
    // The invoice, then the wallets under an empty line, as the mockup draws them.
    info: none
      ? invoiceLines
      : [
          [...invoiceLines, withdraw.confirm.fees(feeText(choices.feeLamports))].join("\n"),
          tree(null, wallets.map(choiceLine)),
        ].join("\n\n"),
    flags: options.flags,
    keyboard: none
      ? [[cbBtn(en.menu.wallets, WALLET_CB.list), cbBtn(en.btn.back, back)]]
      : [
          // The labels of the wallets list (V1-10).
          ...wallets.map(({ wallet }) => [
            cbBtn(en.wallets.btnWallet(wallet.name), PAY_CB.wallet(invoice.id, wallet.id)),
          ]),
          [cbBtn(en.btn.cancel, back)],
        ],
  });
}

/** Step 2: what §8.3 requires on it, the source, the amount, the deposit address and the fees. */
export function buildPayConfirmScreen(
  ui: Ui,
  quote: PayQuote,
  token: string,
  options: { flags?: OptionalLine[] } = {},
): Screen {
  const { invoice, wallet } = quote;
  return renderScreen({
    header: ui.screenHeader(texts.confirm.title),
    description: texts.confirm.description,
    info: [
      texts.confirm.for(en.plans[invoice.offer.plan], en.durations[invoice.offer.duration]),
      texts.confirm.from(
        escapeHtml(wallet.name),
        shortAddress(wallet.publicKey),
        walletSol(wallet.lamports),
      ),
      // The rest of the invoice: its price only while nothing arrived.
      withdraw.confirm.amount(invoiceAmount(invoice, invoice.remainingLamports)),
      texts.confirm.to(code(invoice.depositAddress)),
      withdraw.confirm.fees(feeText(quote.feeLamports)),
    ],
    flags: options.flags,
    keyboard: [
      [
        cbBtn(en.btn.confirm, PAY_CB.confirm(token)),
        cbBtn(en.btn.cancel, SUB_CB.invoice(invoice.id)),
      ],
    ],
  });
}

/** While the transfer is sent and confirmed: no button, nothing to click twice. */
export const buildPaySendingScreen = (ui: Ui, quote: PayQuote): Screen =>
  renderScreen({
    header: ui.screenHeader(texts.sending.title),
    description: texts.sending.description(
      invoiceSol(quote.invoice.remainingLamports),
      escapeHtml(quote.wallet.name),
    ),
    keyboard: [],
  });

/**
 * A payment that did not go through (a `landed` of `no` or `yes`, never `unknown`: that one goes
 * back to the invoice, since the SOL may still arrive). The invoice is still open.
 */
export function buildPayFailureScreen(
  ui: Ui,
  view: { paymentId: string; wallet: WalletBalance; failure: TxFailure },
): Screen {
  const { failure, wallet } = view;
  return renderScreen({
    header: ui.screenHeader(texts.failed.title),
    description: texts.failed.description,
    info: [
      withdraw.result.reason(txFailureText(failure)),
      ...(failure.landed === "no" ? [en.tx.nothingSent] : []),
      texts.failed.from(escapeHtml(wallet.name), walletSol(wallet.lamports)),
    ],
    keyboard: [
      [
        cbBtn(withdraw.result.btnTryAgain, PAY_CB.tryAgain),
        cbBtn(en.btn.back, SUB_CB.invoice(view.paymentId)),
      ],
    ],
  });
}
