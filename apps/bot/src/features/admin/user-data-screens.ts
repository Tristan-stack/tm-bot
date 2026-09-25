import type {
  SupportPayment,
  SupportWithdrawal,
  SweepKind,
  UserBalances,
  UserSupportData,
  WalletSource,
} from "@launchbot/db";
import {
  a,
  adminUserName,
  AI_GENERATIONS_PER_DAY,
  buildSupportCode,
  cbBtn,
  code,
  en,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatRemaining,
  formatSol,
  formatSolExact,
  formatSolWithUsd,
  formatTimeUtc,
  formatUsd,
  GETALL_ERROR_MAX_CHARS,
  invoiceSol,
  isPaid,
  REMAINING_DETAIL_BELOW_MS,
  renderScreen,
  SECOND_MS,
  SENSITIVE_MESSAGE_TTL_MS,
  shortAddress,
  splitHtmlMessage,
  tree,
  WHOIS_PAYMENTS,
} from "@launchbot/shared";
import type { Button, PlanStatus, Screen, Ui, UserRef } from "@launchbot/shared";
import type { WalletSecrets } from "@launchbot/solana";
import { ADMIN_CB, adminHeader, offerLabel } from "./common.js";

// /whois and /getall (§11.4, V1-43): pure renders. User values are escaped here, amounts and
// dates formatted here; nothing of a key ever reaches the card of /getall.

const texts = en.admin;

/** `@username`, else the first name, else `—`. */
const nameOf = (user: { username: string | null; firstName: string | null }) =>
  adminUserName(user) ?? en.common.none;

/**
 * The plan of an account, the date in full: `Premium · 1d 4h left · until 16 Sep 2026, 18:32
 * UTC` (the time left under 72 h), `Classic ⚠️ expired · ended 10 Sep 2026, 14:32 UTC`.
 */
export function planText(plan: PlanStatus, now: Date): string {
  if (plan.kind === "NONE") return texts.common.noPlan;
  const { subscription } = plan;
  const name = en.plans[subscription.plan];
  const at = formatDateTime(subscription.expiresAt);
  if (plan.kind === "EXPIRED") return texts.common.planEnded(en.planStatus.expired(name), at);
  const left = subscription.expiresAt.getTime() - now.getTime() < REMAINING_DETAIL_BELOW_MS;
  return texts.common.planActive(
    name,
    at,
    left ? (formatRemaining(subscription.expiresAt, now) ?? undefined) : undefined,
  );
}

/** The code of the plan of now (V1-40): what support compares the code a user pasted with. */
const supportCodeOf = (data: UserSupportData) =>
  buildSupportCode(
    data.plan.kind === "ACTIVE" ? data.plan.subscription.plan : null,
    data.user.telegramId,
  );

/**
 * `15 Sep 2026, 14:32 UTC · Premium · 1 month · $179.00 · 0.5709 SOL · Paid`: the amount the
 * invoice showed (4 decimals, rounded up); what arrived on an invoice not paid; the refund due
 * on one that ended with SOL on it (§8.3).
 */
function paymentLine(payment: SupportPayment): string {
  const { common } = texts;
  const received =
    !isPaid(payment.status) && payment.receivedLamports > 0n
      ? ` ${common.received(formatSol(payment.receivedLamports, { decimals: 4 }))}`
      : "";
  const refund =
    (payment.status === "EXPIRED" || payment.status === "CANCELED") && payment.receivedLamports > 0n
      ? ` · ${common.refund}`
      : "";
  return [
    formatDateTime(payment.createdAt),
    offerLabel(payment),
    formatUsd(Number(payment.priceUsd)),
    invoiceSol(payment.expectedLamports),
    `${common.paymentStatuses[payment.status]}${received}${refund}`,
  ].join(" · ");
}

/** The code typed does not say the plan of now (a code copied before an expiry). */
function codeMismatch(ref: UserRef, current: string): string | false {
  const typed = ref.claimedPlanLetter;
  if (typed === null || current.startsWith(`${typed}-`)) return false;
  return texts.whois.codeMismatch(code(`${typed}-${ref.telegramId.toString()}`), code(current));
}

/** /whois: the plan before answering a support request (§11.4). No RPC, no key. */
export function buildWhoisScreen(
  ui: Ui,
  model: { data: UserSupportData; ref: UserRef; now: Date },
): Screen {
  const { data, ref, now } = model;
  const current = supportCodeOf(data);
  const payments = data.payments.slice(0, WHOIS_PAYMENTS);
  return renderScreen({
    header: adminHeader(ui, "whois"),
    description: texts.whois.description,
    info: [
      tree(null, [
        nameOf(data.user),
        en.home.id(code(data.user.telegramId.toString())),
        texts.whois.plan(planText(data.plan, now)),
        texts.whois.supportCode(code(current)),
        texts.whois.wallets(data.wallets.length),
      ]),
      tree(
        texts.whois.payments,
        payments.length === 0 ? [texts.whois.noPayment] : payments.map(paymentLine),
      ),
    ].join("\n\n"),
    flags: [codeMismatch(ref, current)],
    keyboard: [],
  });
}

const sourceText = (source: WalletSource) => texts.getall.walletSources[source];

/**
 * The label of a transfer to the treasury before a deletion: every sweep kind has one (checked
 * here), a withdrawal of the user has none.
 */
const sweepLabels: Record<SweepKind, string> & Partial<Record<SupportWithdrawal["kind"], string>> =
  texts.getall.sweepKinds;

/** `14 Sep 2026, 10:02 UTC · Main → 9WzD…AWWM · 0.500 SOL · Confirmed · Explorer` */
export function withdrawalLine(ui: Ui, withdrawal: SupportWithdrawal): string {
  const { getall } = texts;
  const sweep = sweepLabels[withdrawal.kind] ?? null;
  // Its wallet, or where it was: a sweep keeps the address of a wallet deleted with its account.
  const from =
    withdrawal.walletName !== null
      ? escapeHtml(withdrawal.walletName)
      : sweep !== null
        ? shortAddress(withdrawal.fromAddress)
        : getall.deletedWallet;
  const status =
    withdrawal.status === "FAILED"
      ? getall.failed(escapeHtml((withdrawal.error ?? "").slice(0, GETALL_ERROR_MAX_CHARS)))
      : getall.withdrawalStatuses[withdrawal.status];
  return [
    formatDateTime(withdrawal.createdAt),
    ...(sweep === null ? [] : [sweep]),
    getall.route(from, shortAddress(withdrawal.toAddress)),
    formatSolExact(withdrawal.lamports),
    status,
    ...(withdrawal.signature === null
      ? []
      : [a(getall.explorer, ui.explorerTxUrl(withdrawal.signature))]),
  ].join(" · ");
}

/** `10 Sep → 12 Sep 2026`, both years when they differ. */
function periodText(from: Date, to: Date): string {
  const start =
    from.getUTCFullYear() === to.getUTCFullYear() ? formatDayMonth(from) : formatDate(from);
  return texts.getall.period(start, formatDate(to));
}

export type GetAllModel = {
  data: UserSupportData;
  /** `getUserBalances` (cached 30 s): the wallets by id. */
  balances: UserBalances;
  /** `null` hides every USD amount. */
  solUsd: number | null;
  now: Date;
};

/**
 * The card of /getall (§11.4, decision of 16/09/2026): everything support needs, no key. It is
 * the confirmation of Reveal keys, so it lists the wallets whose keys the button would send.
 * Blocks of HTML for `splitHtmlMessage`: the card is often longer than one message.
 */
export function buildGetAllBlocks(ui: Ui, model: GetAllModel): string[] {
  const { data, balances, solUsd, now } = model;
  const { getall } = texts;
  const { user } = data;

  const account = tree(getall.account, [
    user.username !== null && user.firstName !== null
      ? getall.names(escapeHtml(`@${user.username}`), escapeHtml(user.firstName))
      : nameOf(user),
    en.home.id(code(user.telegramId.toString())),
    texts.whois.supportCode(code(supportCodeOf(data))),
    getall.joined(formatDate(user.createdAt), formatDateTime(user.lastActiveAt)),
    user.termsVersion !== null && user.termsAcceptedAt !== null
      ? getall.terms(user.termsVersion, formatDate(user.termsAcceptedAt))
      : getall.noTerms,
  ]);

  const history = data.history.map((period) =>
    getall.historyLine(
      [
        offerLabel(period),
        periodText(period.startsAt, period.expiresAt),
        getall.subscriptionStatuses[period.status],
        period.fromPayment ? getall.origins.payment : getall.origins.grant,
      ].join(" · "),
    ),
  );
  const subscription = tree(getall.subscription, [
    planText(data.plan, now),
    ...(data.aiToday === null ? [] : [getall.aiToday(data.aiToday, AI_GENERATIONS_PER_DAY)]),
    ...(history.length === 0 ? [] : [[getall.history, ...history].join("\n")]),
  ]);

  const purchases = tree(
    data.paymentCount > data.payments.length
      ? getall.purchasesOf(data.payments.length, data.paymentCount)
      : getall.purchases,
    data.payments.length === 0
      ? [getall.noPurchase]
      : data.payments.map(
          (payment) =>
            `${paymentLine(payment)} · ${getall.to(shortAddress(payment.depositAddress))}`,
        ),
  );

  const lamportsOf = new Map(balances.wallets.map((wallet) => [wallet.id, wallet.lamports]));
  const readable = balances.status !== "unavailable" && balances.totalLamports !== null;
  const walletsTitle = `<b>${getall.wallets(
    data.wallets.length,
    readable && data.wallets.length > 0
      ? formatSolWithUsd(balances.totalLamports ?? 0n, solUsd)
      : undefined,
  )}</b>`;
  const wallets =
    data.wallets.length === 0
      ? [walletsTitle, getall.noWallet].join("\n")
      : [
          walletsTitle,
          ...data.wallets.flatMap((wallet, index) => {
            const lamports = lamportsOf.get(wallet.id);
            return [
              getall.wallet(
                index + 1,
                escapeHtml(wallet.name),
                sourceText(wallet.source),
                formatDate(wallet.createdAt),
              ),
              getall.walletAddress(code(wallet.publicKey)),
              getall.walletBalance(
                readable && lamports !== undefined && lamports !== null
                  ? formatSolWithUsd(lamports, solUsd)
                  : getall.balanceUnavailable,
              ),
            ];
          }),
        ].join("\n");

  const withdrawals = tree(
    getall.withdrawals,
    data.withdrawals.length === 0
      ? [getall.noWithdrawal]
      : data.withdrawals.map((withdrawal) => withdrawalLine(ui, withdrawal)),
  );

  return [
    getall.description,
    account,
    subscription,
    purchases,
    wallets,
    withdrawals,
    getall.counts(data.drafts, data.simulations),
    en.common.updated(formatTimeUtc(balances.fetchedAt)),
  ];
}

/** The card as messages: the header on each part, the buttons on the last one. */
export function buildGetAllMessages(ui: Ui, model: GetAllModel): string[] {
  return splitHtmlMessage(buildGetAllBlocks(ui, model), {
    header: adminHeader(ui, "getall"),
  });
}

/** `[ 🔑 Reveal keys ][ ❌ Cancel ]`, only when there are keys to reveal. */
export const revealKeyboard = (nonce: string): Button[][] => [
  [
    cbBtn(texts.getall.btnReveal, ADMIN_CB.reveal(nonce)),
    cbBtn(en.btn.cancel, ADMIN_CB.revealCancel(nonce)),
  ],
];

/**
 * Under « User not found. »: the transfers to the treasury of a deleted account, for inactivity
 * (V1-45) or by /purge (V1-44), for a refund by hand.
 */
export function treasurySweepLines(ui: Ui, sweeps: SupportWithdrawal[]): string[] {
  if (sweeps.length === 0) return [];
  return [texts.getall.deletedAccount, ...sweeps.map((sweep) => `· ${withdrawalLine(ui, sweep)}`)];
}

/** A wallet of the keys message: its secrets, or why there are none. */
export type RevealedWallet = {
  name: string;
  publicKey: string;
  source: WalletSource;
  /** `null`: the decryption failed. */
  secrets: WalletSecrets | null;
};

function walletKeysBlock(index: number, wallet: RevealedWallet): string {
  const { getall } = texts;
  const lines = [
    getall.keysWallet(index, escapeHtml(wallet.name), sourceText(wallet.source)),
    getall.address(code(wallet.publicKey)),
  ];
  if (wallet.secrets === null) return [...lines, getall.decryptFailed].join("\n");
  const { privateKeyBase58, mnemonic } = wallet.secrets;
  const seed =
    mnemonic !== null
      ? code(mnemonic)
      : wallet.source === "IMPORTED_KEY"
        ? getall.noSeed
        : getall.seedUnavailable;
  return [...lines, getall.privateKey(code(privateKeyBase58)), getall.seedPhrase(seed)].join("\n");
}

/**
 * The keys message (decision of 16/09/2026): one block per wallet, never cut, each part with the
 * header, its `Part 2/3` and the warning, since each is deleted on its own after 60 s.
 */
export function buildWalletKeysMessages(
  ui: Ui,
  model: {
    user: { telegramId: bigint; username: string | null; firstName: string | null };
    wallets: RevealedWallet[];
  },
): string[] {
  const { user, wallets } = model;
  return splitHtmlMessage(
    [
      texts.getall.keysOwner(nameOf(user), code(user.telegramId.toString()), wallets.length),
      ...wallets.map((wallet, index) => walletKeysBlock(index + 1, wallet)),
    ],
    {
      header: ui.screenHeader(texts.getall.keysTitle),
      footer: texts.getall.keysWarning(SENSITIVE_MESSAGE_TTL_MS / SECOND_MS),
    },
  );
}
