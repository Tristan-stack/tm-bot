import type { WalletDetailData, WalletListData, WalletSummary } from "@launchbot/db";
import {
  cancelBtn,
  cbBtn,
  code,
  en,
  encodeCallback,
  escapeHtml,
  formatDate,
  formatSolAmount,
  formatSolWithUsd,
  formatTimeUtc,
  NAV_HOME,
  navRow,
  renderInputScreen,
  renderScreen,
  shortAddress,
  urlBtn,
  WALLET_NAME_MAX_CHARS,
} from "@launchbot/shared";
import type { Screen, Ui } from "@launchbot/shared";

/** Callback data of the section (§4.4). V1-12 and V1-14 take over these values. */
export const WALLET_CB = {
  list: encodeCallback("wal", "list"),
  refreshList: encodeCallback("wal", "lref"),
  create: encodeCallback("wal", "new"),
  import: encodeCallback("wal", "imp"),
  view: (id: string) => encodeCallback("wal", "v", id),
  refresh: (id: string) => encodeCallback("wal", "ref", id),
  withdraw: (id: string) => encodeCallback("wal", "wd", id),
  rename: (id: string) => encodeCallback("wal", "ren", id),
  delete: (id: string) => encodeCallback("wal", "del", id),
  confirmDelete: (id: string) => encodeCallback("wal", "delok", id),
  /** V1-14 opens the withdrawal with Max already chosen. */
  withdrawAll: (id: string) => encodeCallback("wal", "wdall", id),
} as const;

/** The data of the service plus the SOL price: `null` hides every USD amount (§4.3). */
export type WalletListView = WalletListData & { solUsd: number | null };
export type WalletDetailView = WalletDetailData & { solUsd: number | null };

/** `2.500 SOL ($258.40)`, `2.500 SOL` without a price, `— SOL` without a balance. */
const balanceText = (lamports: bigint | null, solUsd: number | null): string =>
  lamports === null ? en.wallets.unavailableSol : formatSolWithUsd(lamports, solUsd);

/**
 * The list (§9.1). Pure: the same data gives the same screen, so a Refresh with nothing new
 * gets "Already up to date". "Updated" sits under the total, as in the mockup, so the flags
 * come last, right above the keyboard.
 */
export function buildWalletListScreen(
  ui: Ui,
  view: WalletListView,
  options: { notice?: string; flag?: string } = {},
): Screen {
  const { wallets, solUsd } = view;
  const entries = wallets.map((wallet, index) =>
    en.wallets.entry(
      index + 1,
      escapeHtml(wallet.name),
      `${shortAddress(wallet.publicKey)} · ${balanceText(wallet.lamports, solUsd)}`,
    ),
  );
  const info =
    wallets.length === 0
      ? en.wallets.empty
      : [
          entries.join("\n"),
          "",
          en.wallets.total(balanceText(view.totalLamports, solUsd)),
          en.common.updated(formatTimeUtc(view.fetchedAt)),
        ].join("\n");

  return renderScreen({
    header: ui.screenHeader(en.wallets.title, en.wallets.counter(view.count, view.limit)),
    description: en.wallets.description,
    info,
    flags: [
      view.status === "unavailable" && wallets.length > 0 && en.wallets.balancesUnavailable,
      options.flag,
      options.notice,
    ],
    keyboard: [
      ...wallets.map((wallet) => [
        cbBtn(en.wallets.btnWallet(wallet.name), WALLET_CB.view(wallet.id)),
      ]),
      [
        cbBtn(en.wallets.btnCreate, WALLET_CB.create),
        cbBtn(en.wallets.btnImport, WALLET_CB.import),
      ],
      [cbBtn(en.btn.refresh, WALLET_CB.refreshList), ...navRow(NAV_HOME)],
    ],
  });
}

/** The detail (§9.2). `notice` is shown once, by the render that follows an action. */
export function buildWalletDetailScreen(
  ui: Ui,
  view: WalletDetailView,
  options: { notice?: string; flag?: string } = {},
): Screen {
  const { wallet, solUsd } = view;
  return renderScreen({
    header: ui.screenHeader(en.wallets.detail.title(escapeHtml(wallet.name))),
    description: en.wallets.detail.description,
    info: [
      code(wallet.publicKey),
      "",
      en.wallets.detail.balance(balanceText(wallet.lamports, solUsd)),
      en.wallets.detail.created(formatDate(wallet.createdAt)),
      en.common.updated(formatTimeUtc(view.fetchedAt)),
    ].join("\n"),
    flags: [
      wallet.lamports === null && en.wallets.balanceUnavailable,
      options.flag,
      options.notice,
    ],
    keyboard: [
      [cbBtn(en.wallets.btnWithdraw, WALLET_CB.withdraw(wallet.id))],
      [
        cbBtn(en.wallets.btnRename, WALLET_CB.rename(wallet.id)),
        cbBtn(en.wallets.btnDelete, WALLET_CB.delete(wallet.id)),
      ],
      [
        urlBtn(en.wallets.btnExplorer, ui.explorerAddressUrl(wallet.publicKey)),
        cbBtn(en.btn.refresh, WALLET_CB.refresh(wallet.id)),
      ],
      navRow(WALLET_CB.list),
    ],
  });
}

/** Withdraw until V1-14: the wallet line, and Back to the detail. */
export function buildWithdrawSoonScreen(ui: Ui, view: WalletDetailView): Screen {
  const { wallet } = view;
  return renderScreen({
    header: ui.screenHeader(en.wallets.comingSoon.withdraw.title),
    description: en.wallets.comingSoon.withdraw.description,
    info: en.wallets.walletLine(escapeHtml(wallet.name), balanceText(wallet.lamports, view.solUsd)),
    keyboard: [navRow(WALLET_CB.view(wallet.id))],
  });
}

/** Import until V1-12: Back to the list. */
export const buildImportSoonScreen = (ui: Ui): Screen =>
  renderScreen({
    header: ui.screenHeader(en.wallets.comingSoon.import.title),
    description: en.wallets.comingSoon.import.description,
    keyboard: [navRow(WALLET_CB.list)],
  });

/** The input of a new name (§9.3, §4.5). Cancel goes back to the detail (proposal). */
export const buildRenameScreen = (
  ui: Ui,
  wallet: WalletSummary,
  options: { flag?: string } = {},
): Screen =>
  renderInputScreen({
    header: ui.screenHeader(en.wallets.rename.title),
    prompt: en.wallets.rename.prompt,
    current: wallet.name,
    rules: [en.wallets.rename.rules(WALLET_NAME_MAX_CHARS)],
    flags: [options.flag],
    keyboard: [[cancelBtn(WALLET_CB.view(wallet.id))]],
  });

/** §9.3, text of the context: the key is erased, no way back. */
export const buildDeleteConfirmScreen = (ui: Ui, wallet: WalletSummary): Screen =>
  renderScreen({
    header: ui.screenHeader(en.wallets.delete.title),
    description: en.wallets.delete.confirm(escapeHtml(wallet.name), shortAddress(wallet.publicKey)),
    keyboard: [
      [
        cbBtn(en.wallets.delete.btnYes, WALLET_CB.confirmDelete(wallet.id)),
        cancelBtn(WALLET_CB.view(wallet.id)),
      ],
    ],
  });

/** §9.3: the wallet still holds SOL. The sentence of the flag is the whole description. */
export function buildDeleteBlockedScreen(
  ui: Ui,
  wallet: WalletSummary,
  lamports: bigint,
  solUsd: number | null,
): Screen {
  // A balance that rounds to 0.000 is still above the fee budget: said as such (proposal).
  const balance =
    formatSolAmount(lamports) === "0.000"
      ? escapeHtml(en.wallets.delete.dust)
      : formatSolWithUsd(lamports, solUsd);
  return renderScreen({
    header: ui.screenHeader(en.wallets.delete.title),
    description: en.wallets.delete.blocked(escapeHtml(wallet.name), balance),
    keyboard: [
      [cbBtn(en.wallets.delete.btnWithdrawAll, WALLET_CB.withdrawAll(wallet.id))],
      navRow(WALLET_CB.view(wallet.id)),
    ],
  });
}
