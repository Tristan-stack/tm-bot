import { randomBytes } from "node:crypto";
import type {
  WalletSummary,
  Withdrawal,
  WithdrawAmount,
  WithdrawCheck,
  WithdrawOkCheck,
  WithdrawRequest,
} from "@launchbot/db";
import {
  en,
  escapeHtml,
  formatSolExact,
  parseSolToLamports,
  solanaAddressSchema,
} from "@launchbot/shared";
import type { OptionalLine, Screen } from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import { isOnCurve } from "@launchbot/solana";
import type { TxFailure } from "@launchbot/solana";
import type { BotContext, WithdrawState } from "../../context.js";
import type { InputHandler } from "../../navigation/inputs.js";
import { acknowledge, notify } from "../../navigation/notify.js";
import { presentScreen, showScreen } from "../../navigation/show-screen.js";
import type { Block, ShowOptions } from "../../navigation/show-screen.js";
import type { CallbackHandler } from "../../router/callback-router.js";
import type { WalletNav } from "./nav.js";
import {
  buildWithdrawAddressScreen,
  buildWithdrawAmountScreen,
  buildWithdrawConfirmScreen,
  buildWithdrawCustomScreen,
  buildWithdrawFailureScreen,
  buildWithdrawOffCurveScreen,
  buildWithdrawSendingScreen,
  buildWithdrawSuccessScreen,
  presetOf,
  refusalOf,
} from "./withdraw-screens.js";
import type { WithdrawView } from "./withdraw-screens.js";

/** A flow with its address: what every step after the first one needs. */
type Addressed = WithdrawState & { toAddress: string };
const hasAddress = (state: WithdrawState | undefined): state is Addressed =>
  state?.toAddress !== undefined;

type Options = Pick<ShowOptions, "mode" | "input"> & { flags?: OptionalLine[]; block?: Block };

/** The Confirm button of one screen: 8 hex characters, well within the 64 bytes of §4.4. */
const confirmToken = (): string => randomBytes(4).toString("hex");

const requestOf = (amount: string): WithdrawRequest =>
  amount === "max" ? { kind: "max" } : { kind: "exact", lamports: BigInt(amount) };

/**
 * The withdrawal of SOL (§9.5): address, amount, confirmation, result. The state of the flow
 * lives in the session for exactly as long as its screens (`showScreen`), never a secret,
 * never a balance; every step reads the balance again, and the rules are checked by V1-13
 * before anything is signed.
 */
export function createWithdraw(nav: WalletNav) {
  const { ui, withdrawals, data } = nav;

  /** An old button of a flow that is over: the toast, then the wallet or the list. */
  async function stale(ctx: BotContext, walletId?: string): Promise<void> {
    await notify(ctx, en.common.staleButton);
    if (walletId === undefined) await nav.showList(ctx);
    else await nav.showDetail(ctx, walletId);
  }

  /** A wallet the flow cannot go on with, answered on the screen it belongs to. */
  function blockCheck(
    ctx: BotContext,
    check: Exclude<WithdrawCheck, WithdrawOkCheck>,
    mode?: ShowOptions["mode"],
  ): Promise<void> {
    switch (check.status) {
      case "not_found":
        return nav.showNotFound(ctx, mode);
      case "balance_unavailable":
        // Nothing moves on a balance nobody could read: the same rule as Delete (V1-11).
        return nav.blockOnDetail(ctx, check.detail, en.wallets.delete.checkFailed, mode);
      case "nothing_to_withdraw":
        return nav.blockOnDetail(ctx, check.detail, en.wallets.withdraw.nothingToWithdraw, mode);
    }
  }

  const viewOf = async (state: WithdrawState, check: WithdrawOkCheck): Promise<WithdrawView> => ({
    wallet: check.detail.wallet,
    solUsd: await data.getSolUsdPrice(),
    mode: state.mode,
  });

  /** A screen of the flow, or a blocked click on it: the alert, then the screen with the flag. */
  const present = (
    ctx: BotContext,
    state: WithdrawState,
    render: (flags?: OptionalLine[]) => Screen,
    options: Options = {},
  ): Promise<unknown> => presentScreen(ctx, render, { ...options, withdraw: state });

  async function showAddress(
    ctx: BotContext,
    state: WithdrawState,
    check: WithdrawOkCheck,
    options: Options = {},
  ): Promise<void> {
    const view = await viewOf(state, check);
    await present(
      ctx,
      state,
      (flags) => buildWithdrawAddressScreen(ui, view, check.lamports, { flags }),
      { ...options, input: { kind: "withdraw_address" } },
    );
  }

  async function showAmount(
    ctx: BotContext,
    state: Addressed,
    check: WithdrawOkCheck,
    options: Options = {},
  ): Promise<void> {
    const view = { ...(await viewOf(state, check)), ...check, to: state.toAddress };
    await present(ctx, state, (flags) => buildWithdrawAmountScreen(ui, view, { flags }), options);
  }

  async function showCustom(
    ctx: BotContext,
    state: Addressed,
    check: WithdrawOkCheck,
    options: Options = {},
  ): Promise<void> {
    const view = { ...(await viewOf(state, check)), ...check, to: state.toAddress };
    await present(ctx, state, (flags) => buildWithdrawCustomScreen(ui, view, { flags }), {
      ...options,
      input: { kind: "withdraw_amount" },
    });
  }

  /**
   * An amount the rules refuse (§9.5): back to the amount step with the flag. A Max that is
   * refused in mode `all` (an empty destination under the minimum) turns the flow into a
   * normal one, so the user can choose (proposal).
   */
  async function refuseAmount(
    ctx: BotContext,
    state: Addressed,
    check: WithdrawOkCheck,
    failure: TxFailure,
    mode?: ShowOptions["mode"],
  ): Promise<void> {
    delete state.amount;
    delete state.confirmToken;
    state.mode = "normal";
    await showAmount(ctx, state, check, { block: refusalOf(failure), mode });
  }

  /**
   * The confirmation (§9.5): the amount quoted on a fresh balance, a rule broken meanwhile
   * sends the user back to the amount step. Its Confirm button carries a token of its own.
   */
  async function showConfirm(
    ctx: BotContext,
    state: Addressed,
    amount: WithdrawAmount,
    options: Options = {},
  ): Promise<void> {
    const result = await withdrawals.quote(ctx.user.id, state.walletId, state.toAddress, amount);
    if (result.status === "refused") {
      return refuseAmount(ctx, state, result.check, result.failure, options.mode);
    }
    if (result.status !== "ok") return blockCheck(ctx, result, options.mode);

    // A share of the balance is now a number: a Try again sends this amount, not a new share.
    state.amount = amount.kind === "max" ? "max" : result.quote.amountLamports.toString();
    const token = confirmToken();
    state.confirmToken = token;
    const view = await viewOf(state, result.check);
    await present(
      ctx,
      state,
      (flags) => buildWithdrawConfirmScreen(ui, view, result.quote, token, { flags }),
      options,
    );
  }

  /** After the address: the amount step, or straight to the confirmation in mode `all`. */
  const next = (
    ctx: BotContext,
    state: Addressed,
    check: WithdrawOkCheck,
    mode?: ShowOptions["mode"],
  ) =>
    state.mode === "all"
      ? showConfirm(ctx, state, { kind: "max" }, { mode })
      : showAmount(ctx, state, check, { mode });

  /** The flow is over: the result screen belongs to no flow, so the state goes with it. */
  async function showSuccess(
    ctx: BotContext,
    walletId: string,
    withdrawal: Withdrawal,
  ): Promise<void> {
    const solUsd = await data.getSolUsdPrice();
    await showScreen(ctx, buildWithdrawSuccessScreen(ui, { walletId, withdrawal, solUsd }));
  }

  const showFailure = (
    ctx: BotContext,
    state: WithdrawState,
    wallet: WalletSummary,
    withdrawal: Withdrawal,
    failure: TxFailure,
  ): Promise<unknown> =>
    present(ctx, state, () => buildWithdrawFailureScreen(ui, { wallet, withdrawal, failure }));

  /** `wal:wd:<id>` and `wal:wdall:<id>`: the entry of the flow, name fixed by V1-11. */
  async function openWithdraw(
    ctx: BotContext,
    walletId: string,
    options: { preset?: "max" } = {},
  ): Promise<void> {
    const check = await withdrawals.check(ctx.user.id, walletId);
    if (check.status !== "ok") return blockCheck(ctx, check);
    const state: WithdrawState = { walletId, mode: options.preset === "max" ? "all" : "normal" };
    await showAddress(ctx, state, check);
  }

  /** The flow of the session with its address, or the stale-button answer. */
  async function resume(ctx: BotContext): Promise<Addressed | undefined> {
    const state = ctx.session.withdraw;
    if (hasAddress(state)) return state;
    await stale(ctx, state?.walletId);
    return undefined;
  }

  /**
   * Confirm (§9.5): the cheap refusals first, with their alert, then the query is answered,
   * the screen says it is sending, and the withdrawal runs. The token of the button is spent
   * before the send: a second click on the same screen is a stale button, not a second send.
   */
  async function confirm(ctx: BotContext, token: string | undefined): Promise<void> {
    const state = ctx.session.withdraw;
    if (
      !hasAddress(state) ||
      state.amount === undefined ||
      token === undefined ||
      token !== state.confirmToken
    ) {
      return stale(ctx, state?.walletId);
    }
    const request = requestOf(state.amount);
    const { confirm: texts } = en.wallets.withdraw;

    // The row of an attempt still in flight is the lock (§13); it is read before answering,
    // so the refusal can carry its alert.
    const inFlight = await withdrawals.resolve(ctx.user.id, state.walletId);
    if (inFlight?.status === "PENDING") {
      return showConfirm(ctx, state, request, { block: texts.inProgress });
    }
    if (!consumeRateLimit(Number(ctx.user.telegramId), "withdrawal").ok) {
      return showConfirm(ctx, state, request, { block: texts.tooMany });
    }
    delete state.confirmToken;
    await acknowledge(ctx);
    const sending =
      request.kind === "max" ? en.wallets.withdraw.amount.btnMax : formatSolExact(request.lamports);
    await showScreen(ctx, buildWithdrawSendingScreen(ui, sending), { withdraw: state });

    const outcome = await withdrawals.execute(
      ctx.user.id,
      state.walletId,
      state.toAddress,
      request,
    );
    switch (outcome.status) {
      case "sent":
        return showSuccess(ctx, state.walletId, outcome.withdrawal);
      case "failed":
        // An unknown outcome left the row PENDING: Try again reads the chain first.
        await showFailure(ctx, state, outcome.wallet, outcome.withdrawal, outcome.failure);
        return;
      case "refused": {
        const check = await withdrawals.check(ctx.user.id, state.walletId);
        if (check.status !== "ok") return blockCheck(ctx, check);
        return refuseAmount(ctx, state, check, outcome.failure);
      }
      case "in_progress":
        return showConfirm(ctx, state, request, { flags: [texts.inProgress.flag] });
      case "not_found":
        return nav.showNotFound(ctx);
    }
  }

  /** Try again: an attempt of unknown outcome is read from the chain first (§9.5). */
  async function tryAgain(ctx: BotContext): Promise<void> {
    const state = ctx.session.withdraw;
    if (!hasAddress(state) || state.amount === undefined) return stale(ctx, state?.walletId);
    const request = requestOf(state.amount);

    const previous = await withdrawals.resolve(ctx.user.id, state.walletId);
    if (previous?.status === "CONFIRMED") return showSuccess(ctx, state.walletId, previous);
    if (previous?.status === "PENDING") {
      return showConfirm(ctx, state, request, {
        flags: [en.wallets.withdraw.confirm.previousMayLand],
      });
    }
    await showConfirm(ctx, state, request);
  }

  const address: InputHandler<"withdraw_address"> = async (ctx, _pending, text) => {
    const mode = "edit";
    const state = ctx.session.withdraw;
    if (state === undefined) {
      await nav.showList(ctx, { mode });
      return;
    }
    const check = await withdrawals.check(ctx.user.id, state.walletId);
    if (check.status !== "ok") return blockCheck(ctx, check, mode);
    const retry = (flag: string) => showAddress(ctx, state, check, { flags: [flag], mode });
    const { address: texts } = en.wallets.withdraw;

    if (text === undefined) return retry(texts.notText);
    const parsed = solanaAddressSchema.safeParse(text);
    if (!parsed.success) return retry(texts.invalid);
    const to = parsed.data;
    if (to === check.detail.wallet.publicKey) {
      return retry(texts.sameWallet(escapeHtml(check.detail.wallet.name)));
    }
    state.toAddress = to;
    if (!hasAddress(state)) return;
    // Not on the curve: often a program account, said before anything else (§9.5).
    if (!isOnCurve(to)) {
      const view = await viewOf(state, check);
      await present(ctx, state, () => buildWithdrawOffCurveScreen(ui, view, to), { mode });
      return;
    }
    await next(ctx, state, check, mode);
  };

  const amount: InputHandler<"withdraw_amount"> = async (ctx, _pending, text) => {
    const mode = "edit";
    const state = ctx.session.withdraw;
    if (!hasAddress(state)) {
      await nav.showList(ctx, { mode });
      return;
    }
    // The wallet is read again only to draw the input again: a valid amount goes to the quote.
    const retry = async (flag: string) => {
      const check = await withdrawals.check(ctx.user.id, state.walletId);
      if (check.status !== "ok") return blockCheck(ctx, check, mode);
      await showCustom(ctx, state, check, { flags: [flag], mode });
    };
    const { custom } = en.wallets.withdraw.amount;

    if (text === undefined) return retry(custom.notText);
    const lamports = parseSolToLamports(text);
    if (lamports === null) return retry(custom.invalid);
    await showConfirm(ctx, state, { kind: "exact", lamports }, { mode });
  };

  const handlers: Record<string, CallbackHandler> = {
    wd: (ctx, [id]) => openWithdraw(ctx, id ?? ""),
    wdall: (ctx, [id]) => openWithdraw(ctx, id ?? "", { preset: "max" }),

    async wx(ctx, [step, arg]) {
      if (step === "ok") return confirm(ctx, arg);
      if (step === "re") return tryAgain(ctx);
      const state = await resume(ctx);
      if (state === undefined) return;
      const pct = presetOf(step);
      if (pct !== undefined) return showConfirm(ctx, state, { kind: "pct", pct });
      if (step === "max") return showConfirm(ctx, state, { kind: "max" });
      if (step !== "go" && step !== "cus") return stale(ctx, state.walletId);
      const check = await withdrawals.check(ctx.user.id, state.walletId);
      if (check.status !== "ok") return blockCheck(ctx, check);
      return step === "go" ? next(ctx, state, check) : showCustom(ctx, state, check);
    },
  };

  return { openWithdraw, handlers, inputs: { address, amount } };
}
