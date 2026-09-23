import type { WalletSummary, Withdrawal, WithdrawOkCheck } from "@launchbot/db";
import {
  a,
  cancelBtn,
  cbBtn,
  code,
  en,
  encodeCallback,
  escapeHtml,
  formatSol,
  formatSolExact,
  formatSolWithUsd,
  NAV_HOME,
  renderInputScreen,
  renderScreen,
  shortAddress,
  usdOf,
  warn,
  WITHDRAWAL_PRESETS_PCT,
  withUsd,
} from "@launchbot/shared";
import type {
  OptionalLine,
  Screen,
  TxFailureCode,
  Ui,
  WithdrawalPresetPct,
} from "@launchbot/shared";
import type { TransferQuote, TxFailure } from "@launchbot/solana";
import type { WithdrawMode } from "../../context.js";
import type { Block } from "../../navigation/show-screen.js";
import { WALLET_CB } from "./screens.js";

/**
 * The steps of a withdrawal (§4.4): the state lives in the session, the argument names the
 * step. Confirm carries the token of the screen it is on, so an older Confirm is a stale button.
 */
export const WITHDRAW_CB = {
  continueAnyway: encodeCallback("wal", "wx", "go"),
  pct: (pct: WithdrawalPresetPct) => encodeCallback("wal", "wx", `p${pct}`),
  max: encodeCallback("wal", "wx", "max"),
  custom: encodeCallback("wal", "wx", "cus"),
  confirm: (token: string) => encodeCallback("wal", "wx", "ok", token),
  tryAgain: encodeCallback("wal", "wx", "re"),
} as const;

/** The share a `wal:wx:p25` names, `undefined` for any other step. */
export const presetOf = (step: string | undefined): WithdrawalPresetPct | undefined =>
  WITHDRAWAL_PRESETS_PCT.find((pct) => step === `p${pct}`);

/** What every step shows of the wallet and of the flow it is in. */
export type WithdrawView = { wallet: WalletSummary; solUsd: number | null; mode: WithdrawMode };
export type WithdrawAmountView = WithdrawView & { to: string } & Pick<
    WithdrawOkCheck,
    "lamports" | "feeLamports" | "maxLamports" | "rentMinLamports"
  >;
export type WithdrawFailureView = {
  wallet: WalletSummary;
  withdrawal: Withdrawal;
  failure: TxFailure;
};

type Step = "address" | "amount" | "confirm";
/** Mode `all` has no amount step: Address › Confirm (§9.3). */
const STEPS: Record<WithdrawMode, Record<Step, number>> = {
  normal: { address: 1, amount: 2, confirm: 3 },
  all: { address: 1, amount: 2, confirm: 2 },
};

const header = (ui: Ui, mode: WithdrawMode, step: Step): string =>
  ui.flowHeader({ flow: mode === "all" ? "WITHDRAW_ALL" : "WITHDRAW", step: STEPS[mode][step] });

const { withdraw } = en.wallets;

const fromLine = (wallet: WalletSummary): string =>
  withdraw.from(escapeHtml(wallet.name), shortAddress(wallet.publicKey));

/** `0.00089 SOL`: the rent-exempt minimum as §9.5 writes it, 5 decimals, not the lamport. */
const rentMinText = (lamports: bigint): string => formatSol(lamports, { decimals: 5, trim: true });

/** `1.250 SOL ($129.20)`: exact to the lamport, with its USD value when there is a price. */
const exactWithUsd = (lamports: bigint, solUsd: number | null): string =>
  withUsd(formatSolExact(lamports), usdOf(lamports, solUsd));

const cancel = (view: WithdrawView) => cancelBtn(WALLET_CB.view(view.wallet.id));

/** Step 1 (§9.5): the input of the address, Cancel back to the detail. */
export const buildWithdrawAddressScreen = (
  ui: Ui,
  view: WithdrawView,
  lamports: bigint,
  options: { flags?: OptionalLine[] } = {},
): Screen =>
  renderInputScreen({
    header: header(ui, view.mode, "address"),
    prompt: withdraw.address.prompt,
    rules: [
      fromLine(view.wallet),
      withdraw.address.balance(formatSolWithUsd(lamports, view.solUsd)),
      ...(view.mode === "all" ? [withdraw.address.amountMax] : []),
      withdraw.address.rules,
    ],
    flags: options.flags,
    keyboard: [[cancel(view)]],
  });

/** Step 1 bis: an address that is not on the ed25519 curve, often a program account. */
export const buildWithdrawOffCurveScreen = (ui: Ui, view: WithdrawView, to: string): Screen =>
  renderScreen({
    header: header(ui, view.mode, "address"),
    description: withdraw.offCurve.warning,
    info: withdraw.to(escapeHtml(to)),
    keyboard: [[cbBtn(withdraw.offCurve.btnContinue, WITHDRAW_CB.continueAnyway), cancel(view)]],
  });

/** Step 2: the shares of the balance, Max, and Custom. */
export const buildWithdrawAmountScreen = (
  ui: Ui,
  view: WithdrawAmountView,
  options: { flags?: OptionalLine[] } = {},
): Screen =>
  renderScreen({
    header: header(ui, view.mode, "amount"),
    description: withdraw.amount.prompt,
    info: [
      fromLine(view.wallet),
      withdraw.to(shortAddress(view.to)),
      withdraw.amount.available(formatSolWithUsd(view.lamports, view.solUsd)),
      withdraw.amount.feesAndMax(
        formatSolExact(view.feeLamports),
        formatSolExact(view.maxLamports),
      ),
    ],
    flags: options.flags,
    keyboard: [
      [
        ...WITHDRAWAL_PRESETS_PCT.map((pct) =>
          cbBtn(withdraw.amount.btnPct(pct), WITHDRAW_CB.pct(pct)),
        ),
        cbBtn(withdraw.amount.btnMax, WITHDRAW_CB.max),
      ],
      [cbBtn(withdraw.amount.btnCustom, WITHDRAW_CB.custom)],
      [cancel(view)],
    ],
  });

/** Step 2, Custom: the input of an amount, with the two bounds the rules of §9.5 give it. */
export const buildWithdrawCustomScreen = (
  ui: Ui,
  view: WithdrawAmountView,
  options: { flags?: OptionalLine[] } = {},
): Screen =>
  renderInputScreen({
    header: header(ui, view.mode, "amount"),
    prompt: withdraw.amount.custom.prompt,
    rules: [
      fromLine(view.wallet),
      withdraw.to(shortAddress(view.to)),
      withdraw.amount.available(formatSolWithUsd(view.lamports, view.solUsd)),
      withdraw.amount.custom.rules(
        formatSolExact(view.maxLamports),
        rentMinText(view.rentMinLamports),
      ),
    ],
    flags: options.flags,
    keyboard: [[cancel(view)]],
  });

/** Step 3: everything the transaction will do, exact to the lamport, and the network. */
export const buildWithdrawConfirmScreen = (
  ui: Ui,
  view: WithdrawView,
  quote: TransferQuote,
  token: string,
  options: { flags?: OptionalLine[] } = {},
): Screen => {
  const amount = exactWithUsd(quote.amountLamports, view.solUsd);
  return renderScreen({
    header: header(ui, view.mode, "confirm"),
    description: withdraw.confirm.prompt,
    info: [
      fromLine(view.wallet),
      withdraw.to(code(quote.to)),
      quote.mode === "max" ? withdraw.confirm.amountMax(amount) : withdraw.confirm.amount(amount),
      withdraw.confirm.fees(formatSolExact(quote.fee.totalFeeLamports)),
      withdraw.confirm.network(ui.config.networkName),
    ],
    flags: options.flags,
    keyboard: [[cbBtn(en.btn.confirm, WITHDRAW_CB.confirm(token)), cancel(view)]],
  });
};

/** While the transaction is sent and confirmed: no button, nothing to click twice. */
export const buildWithdrawSendingScreen = (ui: Ui, amount: string): Screen =>
  renderScreen({
    header: ui.screenHeader(withdraw.title),
    description: withdraw.confirm.sending(amount),
    keyboard: [],
  });

/** The signature as a link to the explorer of the cluster (§9.2), previews disabled. */
const signatureLink = (ui: Ui, signature: string): string =>
  a(shortAddress(signature), ui.explorerTxUrl(signature));

/** Step 4, success: what moved, where, for how much, and the transaction. */
export const buildWithdrawSuccessScreen = (
  ui: Ui,
  view: { walletId: string; withdrawal: Withdrawal; solUsd: number | null },
): Screen => {
  const { withdrawal } = view;
  return renderScreen({
    header: ui.screenHeader(withdraw.title),
    info: [
      withdraw.result.sent,
      withdraw.result.amount(exactWithUsd(withdrawal.lamports, view.solUsd)),
      withdraw.to(code(withdrawal.toAddress)),
      withdraw.result.fees(formatSolExact(withdrawal.feeLamports ?? 0n)),
      ...(withdrawal.signature === null
        ? []
        : [withdraw.result.signature(signatureLink(ui, withdrawal.signature))]),
    ],
    keyboard: [
      [
        cbBtn(withdraw.result.btnBackToWallet, WALLET_CB.view(view.walletId)),
        cbBtn(en.btn.menu, NAV_HOME),
      ],
    ],
  });
};

/** The amount a rule of §9.5 quotes: what is missing, or the rent-exempt minimum. */
const ruleAmount = (failure: TxFailure): string | undefined => {
  if (failure.code === "INSUFFICIENT_FUNDS") {
    return failure.missingLamports === undefined
      ? undefined
      : formatSolExact(failure.missingLamports);
  }
  return failure.rentMinLamports === undefined ? undefined : rentMinText(failure.rentMinLamports);
};

/** The text of a failure of V1-13 (`en.tx.errors`), with its amount formatted. */
export function txFailureText(failure: TxFailure): string {
  const text = en.tx.errors[failure.code];
  return typeof text === "function" ? text(ruleAmount(failure)) : text;
}

/** The two rules the amount step says shorter (§9.5); every other code reads its text. */
const REFUSALS: Partial<Record<TxFailureCode, (amount?: string) => Block>> =
  withdraw.amount.refused;

/** A refused amount on the amount step: the alert of the click and the flag of the screen. */
export const refusalOf = (failure: TxFailure): Block =>
  REFUSALS[failure.code]?.(ruleAmount(failure)) ?? warn(txFailureText(failure));

/**
 * Step 4, failure: the reason, whether anything left (only a `no` says so), and the attempt.
 * An outcome still unknown shows the signature: the explorer is the place to look.
 */
export const buildWithdrawFailureScreen = (ui: Ui, view: WithdrawFailureView): Screen => {
  const { withdrawal, failure } = view;
  return renderScreen({
    header: ui.screenHeader(withdraw.title),
    description: [
      withdraw.result.failed,
      withdraw.result.reason(txFailureText(failure)),
      ...(failure.landed === "no" ? [en.tx.nothingSent] : []),
    ],
    info: [
      fromLine(view.wallet),
      withdraw.to(shortAddress(withdrawal.toAddress)),
      withdraw.result.amount(formatSolExact(withdrawal.lamports)),
      ...(failure.landed === "unknown" && withdrawal.signature !== null
        ? [withdraw.result.signature(signatureLink(ui, withdrawal.signature))]
        : []),
    ],
    keyboard: [
      [
        cbBtn(withdraw.result.btnTryAgain, WITHDRAW_CB.tryAgain),
        cbBtn(withdraw.result.btnBackToWallet, WALLET_CB.view(view.wallet.id)),
      ],
    ],
  });
};
