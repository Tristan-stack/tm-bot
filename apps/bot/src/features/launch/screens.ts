import type { TokenDraftFields, WalletBalance } from "@launchbot/db";
import {
  a,
  BUNDLE_MAX_LAMPORTS,
  BUNDLE_PRESETS_SOL,
  bundleStatuses,
  cancelBtn,
  cbBtn,
  code,
  DEV_BUY_SOL,
  en,
  encodeCallback,
  escapeHtml,
  FEE_MARGIN_LAMPORTS,
  formatSol,
  formatSolWithUsd,
  formatTimeUtc,
  lamportsToSol,
  LAUNCH_COIN,
  launchShortfallLamports,
  NAV_HOME,
  navRow,
  renderInputScreen,
  renderScreen,
  smallestLaunchShortfall,
  TOKEN_CREATION_ENABLED,
  tree,
} from "@launchbot/shared";
import type { OptionalLine, Screen, Ui } from "@launchbot/shared";
import type { CurveParams } from "@launchbot/sim-engine";
import { renderBuyLines, renderTokenRecapBlock } from "../simulation/screens.js";
import type { ReadyToken } from "../simulation/screens.js";
import { WALLET_CB } from "../wallets/screens.js";

/**
 * Callback data of Launch Coin (§4.4, `lc`, V1-35 to V1-37): the state of the flow is in the
 * session, so a button carries at most the id of a wallet or a preset. `open` is the menu
 * button and the one of « Payment received » (V1-30, V1-32).
 */
export const LAUNCH_CB = {
  open: LAUNCH_COIN,
  wallet: (walletId: string) => encodeCallback("lc", "w", walletId),
  /** Back of step 2. */
  walletStep: encodeCallback("lc", "s1"),
  /** Back of the Token step. */
  bundleStep: encodeCallback("lc", "s2"),
  /** Back of the recap. */
  tokenStep: encodeCallback("lc", "s3"),
  preset: (sol: number) => encodeCallback("lc", "b", sol),
  custom: encodeCallback("lc", "b", "c"),
  cancelCustom: encodeCallback("lc", "b", "cx"),
  refresh: encodeCallback("lc", "b", "r"),
  create: encodeCallback("lc", "create"),
} as const;

const { launch } = en;
// The lines of a wallet that can pay or not: the ones of Pay from my wallet (V1-31).
const { walletOk, walletShort } = en.subscribe.payFromWallet;

/** What is missing, rounded up: whoever sends it is never short (proposal). */
const missingText = (lamports: bigint): string => formatSol(lamports, { rounding: "ceil" });
/** An amount to buy, without trailing zeros: `1 SOL`, `3.5 SOL`. */
const amountText = (lamports: bigint): string => formatSol(lamports, { trim: true });
/** The Custom maximum, floored upstream: `3.200 SOL`, and the cap as the rules say it, `20 SOL`. */
const customMaxText = (lamports: bigint): string =>
  lamports === BUNDLE_MAX_LAMPORTS ? amountText(lamports) : formatSol(lamports);

/** `Main · 4.200 SOL`, with its USD on step 2 (§4.3), or `Main · balance unavailable`. */
const walletSummary = (wallet: WalletBalance, solUsd: number | null = null): string => {
  const name = escapeHtml(wallet.name);
  return wallet.lamports === null
    ? launch.wallet.unknown(name)
    : `${name} · ${formatSolWithUsd(wallet.lamports, solUsd)}`;
};

/** A wallet with what it lacks: `Test · 0.400 SOL ⚠️ Insufficient funds (3.600 SOL missing)`. */
const shortWalletLine = (wallet: WalletBalance, lamports: bigint, shortfall: bigint): string =>
  walletShort(escapeHtml(wallet.name), formatSol(lamports), missingText(shortfall));

/**
 * The choices already made (§15): the wallet, the dev buy, and the bundle once chosen. Step 2
 * shows them with the USD value of the balance, the Token step (its `summaryLines`) without.
 */
export const launchSummaryLines = (
  wallet: WalletBalance | undefined,
  bundleLamports: bigint | undefined,
  solUsd: number | null = null,
): string[] => [
  ...(wallet === undefined ? [] : [en.token.summaryWallet(walletSummary(wallet, solUsd))]),
  en.token.summaryDevBuy,
  ...(bundleLamports === undefined ? [] : [en.token.summaryBundle(amountText(bundleLamports))]),
];

/** The note under the list after a click on a wallet that cannot launch (§10.1). */
export const insufficientWalletNote = (wallet: WalletBalance, shortfall: bigint): string =>
  launch.wallet.insufficient(
    escapeHtml(wallet.name),
    missingText(shortfall),
    code(wallet.publicKey),
  );

const walletLine = (wallet: WalletBalance): string => {
  if (wallet.lamports === null) return walletSummary(wallet);
  const shortfall = smallestLaunchShortfall(wallet.lamports);
  return shortfall === 0n
    ? walletOk(escapeHtml(wallet.name), formatSol(wallet.lamports))
    : shortWalletLine(wallet, wallet.lamports, shortfall);
};

/**
 * Step 1/4 (§10.1): every wallet of the user, oldest first, over the limit of the plan too
 * (§8.1), with whether it can pay the smallest launch (D13). No USD on this step.
 */
export function buildWalletStepScreen(
  ui: Ui,
  wallets: readonly WalletBalance[],
  options: { flags?: OptionalLine[] } = {},
): Screen {
  const description = [launch.wallet.description, launch.wallet.minimum];
  const header = ui.flowHeader({ flow: "LAUNCH", step: 1 });
  if (wallets.length === 0) {
    return renderScreen({
      header,
      description,
      info: en.subscribe.payFromWallet.noWallet,
      flags: options.flags,
      keyboard: [[cbBtn(en.menu.wallets, WALLET_CB.list), cbBtn(en.btn.back, NAV_HOME)]],
    });
  }
  return renderScreen({
    header,
    description,
    info: tree(null, wallets.map(walletLine)),
    flags: options.flags,
    keyboard: [
      // Button labels are plain text for Telegram: the name as it was typed.
      ...wallets.map((wallet) => [cbBtn(wallet.name, LAUNCH_CB.wallet(wallet.id))]),
      navRow(NAV_HOME),
    ],
  });
}

export type BundleStepView = {
  wallet: WalletBalance;
  solUsd: number | null;
  /** The bundle chosen before, on the way back from step 3 (proposal). */
  bundleLamports?: bigint;
  /** A bundle the wallet could not cover: its note and Refresh (§10.1). */
  blockedLamports?: bigint;
  /** After a Refresh: `🕒 Updated 14:32 UTC` (§4.5). */
  refreshedAt?: Date;
};

/**
 * Step 2/4 (§10.1, decision of 25/09/2026): the dev buy of 1 SOL, then the line of each bundle,
 * always, and the note and Refresh once a bundle the wallet cannot cover was clicked. An
 * unreadable balance says so, with Refresh.
 */
export function buildBundleStepScreen(ui: Ui, view: BundleStepView): Screen {
  const t = launch.bundle;
  const { wallet } = view;
  const balance = wallet.lamports;

  let statusBlock: string;
  let note: string | undefined;
  if (balance === null) {
    statusBlock = t.unreadable;
  } else {
    const { presets, customMaxLamports } = bundleStatuses(balance);
    statusBlock = tree(null, [
      ...presets.map(({ lamports, shortfall }) =>
        shortfall === 0n
          ? t.ok(amountText(lamports))
          : t.short(amountText(lamports), missingText(shortfall)),
      ),
      customMaxLamports === null
        ? t.customShort(missingText(smallestLaunchShortfall(balance)))
        : t.custom(customMaxText(customMaxLamports)),
    ]);
    const blocked = view.blockedLamports;
    const shortfall = blocked === undefined ? 0n : launchShortfallLamports(balance, blocked);
    if (blocked !== undefined && shortfall > 0n) {
      note = t.insufficient(escapeHtml(wallet.name), amountText(blocked), missingText(shortfall));
    }
  }
  const updated =
    view.refreshedAt === undefined ? [] : [en.common.updated(formatTimeUtc(view.refreshedAt))];

  return renderScreen({
    header: ui.flowHeader({ flow: "LAUNCH", step: 2 }),
    description: t.description,
    info: [
      launchSummaryLines(wallet, view.bundleLamports, view.solUsd).join("\n"),
      statusBlock,
      ...updated,
    ].join("\n\n"),
    flags: [note],
    keyboard: [
      BUNDLE_PRESETS_SOL.map((sol) => cbBtn(en.sim.bundle.btnPreset(sol), LAUNCH_CB.preset(sol))),
      [cbBtn(en.sim.bundle.btnCustom, LAUNCH_CB.custom)],
      ...(note !== undefined || balance === null
        ? [[cbBtn(en.btn.refresh, LAUNCH_CB.refresh)]]
        : []),
      navRow(LAUNCH_CB.walletStep),
    ],
  });
}

/** The Custom input of step 2 (§4.5): the rules of the simulation, with this wallet's maximum. */
export function buildLaunchCustomScreen(
  ui: Ui,
  view: {
    wallet: WalletBalance;
    solUsd: number | null;
    bundleLamports?: bigint;
    maxLamports: bigint;
  },
  options: { flags?: OptionalLine[] } = {},
): Screen {
  const { bundleLamports } = view;
  return renderInputScreen({
    header: ui.flowHeader({ flow: "LAUNCH", step: 2 }),
    prompt: en.sim.custom.prompt,
    rules: [
      ...launchSummaryLines(view.wallet, bundleLamports, view.solUsd),
      ...(bundleLamports === undefined ? [en.sim.bundle.notSelected] : []),
      launch.bundle.rules(customMaxText(view.maxLamports)),
    ],
    flags: options.flags,
    keyboard: [[cancelBtn(LAUNCH_CB.cancelCustom)]],
  });
}

export type LaunchRecapView = {
  draft: TokenDraftFields & ReadyToken;
  wallet: WalletBalance;
  bundleLamports: bigint;
  /** The curve of the moment (V1-21): the share of the supply of each buy (§7.1). */
  curve: CurveParams;
  /** `CHANNEL_SUCCESS_URL`: « Success channel » links to it (proposal). */
  successUrl: string;
};

/**
 * Step 4/4 (§10.1): the token as the simulation shows it, the wallet (with what it lacks if its
 * balance fell since step 2), the dev buy, the bundle and their total with their shares, the
 * estimated fees. Create token creates nothing while `TOKEN_CREATION_ENABLED` is off (D6).
 */
export function buildLaunchRecapScreen(ui: Ui, view: LaunchRecapView): Screen {
  const t = launch.recap;
  const { wallet, bundleLamports } = view;
  const balance = wallet.lamports;
  const shortfall = balance === null ? 0n : launchShortfallLamports(balance, bundleLamports);
  return renderScreen({
    header: ui.flowHeader({ flow: "LAUNCH", step: 4 }),
    description: t.description,
    info: [
      renderTokenRecapBlock(view.draft),
      [
        en.token.summaryWallet(
          balance === null || shortfall === 0n
            ? walletSummary(wallet)
            : shortWalletLine(wallet, balance, shortfall),
        ),
        ...renderBuyLines(view.curve, DEV_BUY_SOL, lamportsToSol(bundleLamports)),
        en.wallets.withdraw.confirm.fees(amountText(FEE_MARGIN_LAMPORTS)),
      ].join("\n"),
      t.success(a(t.successLabel, view.successUrl)),
    ].join("\n\n"),
    flags: [!TOKEN_CREATION_ENABLED && t.v2Notice],
    keyboard: [[cbBtn(t.btnCreate, LAUNCH_CB.create)], navRow(LAUNCH_CB.tokenStep, { menu: true })],
  });
}
