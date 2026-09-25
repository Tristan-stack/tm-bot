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
import type { ImportFormat, OptionalLine, Screen, Ui } from "@launchbot/shared";
import { SOLANA_DERIVATION_PATH } from "@launchbot/solana";

/** The callback argument of each format, and the only place the two codes are written. */
const IMPORT_CODE = { KEY: "key", SEED: "seed" } as const satisfies Record<ImportFormat, string>;

/** The format `wal:imp:<code>` asks for, `undefined` for anything else (an old button). */
export const importFormatOf = (code: string | undefined): ImportFormat | undefined =>
  (Object.keys(IMPORT_CODE) as ImportFormat[]).find((format) => IMPORT_CODE[format] === code);

/** Callback data of the section (§4.4). The steps of a withdrawal are in `WITHDRAW_CB`. */
export const WALLET_CB = {
  list: encodeCallback("wal", "list"),
  refreshList: encodeCallback("wal", "lref"),
  create: encodeCallback("wal", "new"),
  import: encodeCallback("wal", "imp"),
  importFormat: (format: ImportFormat) => encodeCallback("wal", "imp", IMPORT_CODE[format]),
  view: (id: string) => encodeCallback("wal", "v", id),
  refresh: (id: string) => encodeCallback("wal", "ref", id),
  withdraw: (id: string) => encodeCallback("wal", "wd", id),
  rename: (id: string) => encodeCallback("wal", "ren", id),
  delete: (id: string) => encodeCallback("wal", "del", id),
  confirmDelete: (id: string) => encodeCallback("wal", "delok", id),
  /** From the Delete blocking (§9.3): the withdrawal with Max already chosen. */
  withdrawAll: (id: string) => encodeCallback("wal", "wdall", id),
} as const;

/** The data of the service plus the SOL price: `null` hides every USD amount (§4.3). */
export type WalletListView = WalletListData & { solUsd: number | null };
export type WalletDetailView = WalletDetailData & { solUsd: number | null };

/** `2.500 SOL ($258.40)`, `2.500 SOL` without a price, `— SOL` without a balance. */
export const balanceText = (lamports: bigint | null, solUsd: number | null): string =>
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

/** What the Import screens show of the plan (§8.1): the counter, nothing about balances. */
export type WalletQuotaView = Pick<WalletListData, "count" | "limit">;

/**
 * IMPORT WALLET (§9.4): the warning of the context, the two formats, and the counter of the
 * plan. The limit is checked before this screen opens, so it is never shown at the limit.
 */
export const buildImportScreen = (
  ui: Ui,
  quota: WalletQuotaView,
  options: { flags?: OptionalLine[] } = {},
): Screen =>
  renderScreen({
    header: ui.screenHeader(en.wallets.import.title),
    description: [en.wallets.import.warning, "", en.wallets.import.description].join("\n"),
    info: en.wallets.import.counter(quota.count, quota.limit),
    flags: options.flags,
    keyboard: [
      [
        cbBtn(en.wallets.import.btnKey, WALLET_CB.importFormat("KEY")),
        cbBtn(en.wallets.import.btnSeed, WALLET_CB.importFormat("SEED")),
      ],
      navRow(WALLET_CB.list),
    ],
  });

/**
 * The input of a secret (§9.4, §4.5): no "Current" line, an expiry instead, and Cancel back to
 * the list. The next message of the user is read as the secret and deleted at once. The seed
 * rules quote the derivation path of the wallet package, so it is never written twice.
 */
export const buildImportInputScreen = (
  ui: Ui,
  format: ImportFormat,
  expiresAt: Date,
  options: { flags?: OptionalLine[] } = {},
): Screen => {
  const { key, seed } = en.wallets.import;
  const texts = format === "KEY" ? key : { ...seed, rules: seed.rules(SOLANA_DERIVATION_PATH) };
  return renderInputScreen({
    header: ui.screenHeader(texts.title),
    prompt: texts.prompt,
    rules: [texts.rules, en.wallets.import.expiresAt(formatTimeUtc(expiresAt))],
    flags: options.flags,
    keyboard: [[cancelBtn(WALLET_CB.list)]],
  });
};

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
