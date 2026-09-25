import type { UserBalances, WalletBalance } from "@launchbot/db";
import {
  BUNDLE_MIN_LAMPORTS,
  bundlePresetLamports,
  customMaxLamports,
  en,
  escapeHtml,
  launchShortfallLamports,
  parseLaunchBundleInput,
  smallestLaunchShortfall,
} from "@launchbot/shared";
import type { Ui } from "@launchbot/shared";
import type { BotContext, LaunchFlowState } from "../../context.js";
import { mayReadFreshBalances } from "../../middleware/rate-limit.js";
import type { InputHandler, InputRouter } from "../../navigation/inputs.js";
import { notify } from "../../navigation/notify.js";
import { notifyIfUnchanged, presentScreen, showScreen } from "../../navigation/show-screen.js";
import type { PresentOptions, ShowMode, ShowResult } from "../../navigation/show-screen.js";
import type { CallbackHandler, CallbackRouter } from "../../router/callback-router.js";
import type { DataServices } from "../../services/data.js";
import type { Access } from "../access/access.js";
import type { Subscribe } from "../subscribe/subscribe.js";
import type { ReadyTokenDraft, TokenStep } from "../token-step/token-step.js";
import {
  buildBundleStepScreen,
  buildLaunchCustomScreen,
  buildLaunchRecapScreen,
  buildWalletStepScreen,
  insufficientWalletNote,
  LAUNCH_CB,
  launchSummaryLines,
} from "./screens.js";

export type LaunchFlowDeps = {
  ui: Ui;
  data: Pick<
    DataServices,
    "getUserBalances" | "getSolUsdPrice" | "getCurveParams" | "getPlanStatus"
  >;
  access: Pick<Access, "ensureChannelMembership" | "registerResume">;
  tokenStep: TokenStep;
  offers: Pick<Subscribe, "showOffersScreen">;
  /** `CHANNEL_SUCCESS_URL` (§3): the recap links « Success channel » to it (proposal). */
  successUrl: string;
};

type Show = Pick<PresentOptions, "mode" | "flags">;
/** The wallet of the flow with the balances it was found in: one read per screen. */
type Loaded = { wallet: WalletBalance; balances: UserBalances };
/** The wallet of the flow and its balance, read: what an amount is checked against. */
type Funded = Loaded & { balance: bigint };

const walletIn = (balances: UserBalances, walletId: string | undefined) =>
  balances.wallets.find((wallet) => wallet.id === walletId);

/**
 * Launch Coin (§10.1, V1-35 to V1-37): the channel checked without cache and an active plan at
 * the entry, then Wallet → Bundle → Token → Recap; the dev buy is a fixed 1 SOL and the bundle
 * leaves the same wallet (decision of 25/09/2026). Nothing is created in V1: Create token
 * answers an alert (D6). The state is in the session (`launch`), the draft in the Token step.
 */
export function registerLaunch(
  router: CallbackRouter,
  inputs: InputRouter,
  deps: LaunchFlowDeps,
): void {
  const { ui, data, access, tokenStep, offers, successUrl } = deps;
  const stateOf = (ctx: BotContext): LaunchFlowState => (ctx.session.launch ??= {});
  const lamportsOf = (value: string | undefined) =>
    value === undefined ? undefined : BigInt(value);

  /**
   * §8, D2: the button is for everyone, the flow for subscribers; a plan can end in the middle
   * of it. The offers say why, the session stays (proposal).
   */
  async function requireSubscription(ctx: BotContext): Promise<boolean> {
    const status = await data.getPlanStatus(ctx.user.id);
    if (status.kind === "ACTIVE") return true;
    await offers.showOffersScreen(ctx, { status, flags: [en.subscribe.launchCoinNeedsPlan] });
    return false;
  }

  async function showWalletStep(
    ctx: BotContext,
    options: Show & { balances?: UserBalances } = {},
  ): Promise<unknown> {
    const { balances, ...show } = options;
    const { wallets } = balances ?? (await data.getUserBalances(ctx.user.id));
    return presentScreen(ctx, (flags) => buildWalletStepScreen(ui, wallets, { flags }), show);
  }

  /** The wallet of the flow, still the user's; step 1 with why when it is not. */
  async function launchWallet(
    ctx: BotContext,
    options: { skipCache?: boolean; mode?: ShowMode } = {},
  ): Promise<Loaded | null> {
    const balances = await data.getUserBalances(ctx.user.id, { skipCache: options.skipCache });
    const { walletId } = stateOf(ctx);
    const wallet = walletIn(balances, walletId);
    if (wallet !== undefined) return { wallet, balances };
    delete stateOf(ctx).walletId;
    await showWalletStep(ctx, {
      balances,
      mode: options.mode,
      flags: [walletId !== undefined && en.launch.wallet.gone],
    });
    return null;
  }

  /** The wallet of the flow with a balance to check an amount against; else step 1 or 2. */
  async function fundedWallet(ctx: BotContext, mode?: ShowMode): Promise<Funded | null> {
    const loaded = await launchWallet(ctx, { mode });
    if (loaded === null) return null;
    const balance = loaded.wallet.lamports;
    if (balance !== null) return { ...loaded, balance };
    await showBundleStep(ctx, { loaded, mode });
    return null;
  }

  /**
   * The flow once the channel is checked (§10.1, §4.2): an active plan, then step 1. The wallet
   * and the bundle are chosen again at each launch (§9); the draft of the token stays (proposal).
   */
  async function startLaunch(ctx: BotContext): Promise<unknown> {
    if (!(await requireSubscription(ctx))) return;
    ctx.session.launch = {};
    return showWalletStep(ctx);
  }

  /** A wallet of step 1: its balance read fresh when the Refresh limit allows (proposal). */
  async function chooseWallet(ctx: BotContext, walletId: string): Promise<unknown> {
    const balances = await data.getUserBalances(ctx.user.id, {
      skipCache: mayReadFreshBalances(ctx),
    });
    const wallet = walletIn(balances, walletId);
    const refuse = (flag: string) => showWalletStep(ctx, { balances, flags: [flag] });
    if (wallet === undefined) return refuse(en.launch.wallet.gone);
    if (wallet.lamports === null)
      return refuse(en.launch.wallet.unreadable(escapeHtml(wallet.name)));
    const shortfall = smallestLaunchShortfall(wallet.lamports);
    if (shortfall > 0n) return refuse(insufficientWalletNote(wallet, shortfall));

    const state = stateOf(ctx);
    if (state.walletId !== walletId) delete state.bundleLamports;
    state.walletId = walletId;
    delete state.blockedLamports;
    return showBundleStep(ctx, { loaded: { wallet, balances } });
  }

  /** Step 2; `refresh` reads the balance fresh when the Refresh limit allows (§4.4). */
  async function showBundleStep(
    ctx: BotContext,
    options: { loaded?: Loaded; mode?: ShowMode; refresh?: boolean } = {},
  ): Promise<ShowResult | null> {
    const { mode, refresh = false } = options;
    const [loaded, solUsd] = await Promise.all([
      options.loaded ??
        launchWallet(ctx, { mode, skipCache: refresh && mayReadFreshBalances(ctx) }),
      data.getSolUsdPrice(),
    ]);
    if (loaded === null) return null;
    const state = stateOf(ctx);
    const balance = loaded.wallet.lamports;
    const blocked = lamportsOf(state.blockedLamports);
    // Covered since (a Refresh after funding): the note goes, the user taps the amount.
    if (
      blocked !== undefined &&
      balance !== null &&
      launchShortfallLamports(balance, blocked) === 0n
    ) {
      delete state.blockedLamports;
    }
    const view = {
      wallet: loaded.wallet,
      solUsd,
      bundleLamports: lamportsOf(state.bundleLamports),
      blockedLamports: lamportsOf(state.blockedLamports),
      refreshedAt: refresh ? loaded.balances.fetchedAt : undefined,
    };
    return showScreen(ctx, buildBundleStepScreen(ui, view), { mode });
  }

  /** An amount the wallet cannot cover: nothing is kept, step 2 says what is missing. */
  function refuseAmount(ctx: BotContext, loaded: Loaded, lamports: bigint, mode?: ShowMode) {
    stateOf(ctx).blockedLamports = lamports.toString();
    return showBundleStep(ctx, { loaded, mode });
  }

  /** An amount the wallet covers: kept, then the Token step with the choices made (§15). */
  function chooseBundle(ctx: BotContext, wallet: WalletBalance, lamports: bigint, mode?: ShowMode) {
    const state = stateOf(ctx);
    state.bundleLamports = lamports.toString();
    delete state.blockedLamports;
    return tokenStep.showTokenStep(ctx, "LAUNCH", {
      mode,
      summaryLines: launchSummaryLines(wallet, lamports),
    });
  }

  async function choosePreset(ctx: BotContext, lamports: bigint): Promise<unknown> {
    const funded = await fundedWallet(ctx);
    if (funded === null) return;
    return launchShortfallLamports(funded.balance, lamports) > 0n
      ? refuseAmount(ctx, funded, lamports)
      : chooseBundle(ctx, funded.wallet, lamports);
  }

  /** Custom (§4.5): the input, unless even the smallest bundle is out of reach — then its note. */
  async function showCustom(
    ctx: BotContext,
    options: Show & { funded?: Funded } = {},
  ): Promise<unknown> {
    const [funded, solUsd] = await Promise.all([
      options.funded ?? fundedWallet(ctx, options.mode),
      data.getSolUsdPrice(),
    ]);
    if (funded === null) return;
    const maxLamports = customMaxLamports(funded.balance);
    if (maxLamports === null) {
      return refuseAmount(ctx, funded, BUNDLE_MIN_LAMPORTS, options.mode);
    }
    const view = {
      wallet: funded.wallet,
      solUsd,
      bundleLamports: lamportsOf(stateOf(ctx).bundleLamports),
      maxLamports,
    };
    return presentScreen(ctx, (flags) => buildLaunchCustomScreen(ui, view, { flags }), {
      mode: options.mode,
      flags: options.flags,
      input: { kind: "launch_amount" },
    });
  }

  /** The Custom amount typed (§4.5): the screen the user's message was answered on is edited. */
  const amountInput: InputHandler<"launch_amount"> = async (ctx, _pending, text) => {
    const mode = "edit";
    if (!(await requireSubscription(ctx))) return;
    const funded = await fundedWallet(ctx, mode);
    if (funded === null) return;
    const parsed = parseLaunchBundleInput(text ?? "", funded.balance);
    if (parsed.ok) {
      await chooseBundle(ctx, funded.wallet, parsed.lamports, mode);
    } else if (parsed.reason === "invalid") {
      await showCustom(ctx, { funded, mode, flags: [en.sim.custom.invalid] });
    } else {
      await refuseAmount(ctx, funded, parsed.lamports, mode);
    }
  };

  /** Step 3 again (Back of the recap): the wallet and the bundle must still be there. */
  async function showLaunchToken(ctx: BotContext): Promise<unknown> {
    const loaded = await launchWallet(ctx);
    if (loaded === null) return;
    const bundleLamports = lamportsOf(stateOf(ctx).bundleLamports);
    if (bundleLamports === undefined) return showBundleStep(ctx, { loaded });
    return tokenStep.showTokenStep(ctx, "LAUNCH", {
      summaryLines: launchSummaryLines(loaded.wallet, bundleLamports),
    });
  }

  /**
   * Step 4/4 (§10.1), from Continue on a token with its name and ticker: the plan, the wallet
   * and the bundle are checked again; whatever is missing sends back to its step.
   */
  async function showRecap(ctx: BotContext, draft: ReadyTokenDraft): Promise<unknown> {
    if (!(await requireSubscription(ctx))) return;
    const [loaded, { curve }] = await Promise.all([launchWallet(ctx), data.getCurveParams()]);
    if (loaded === null) return;
    const bundleLamports = lamportsOf(stateOf(ctx).bundleLamports);
    if (bundleLamports === undefined) return showBundleStep(ctx, { loaded });
    return showScreen(
      ctx,
      buildLaunchRecapScreen(ui, {
        draft,
        wallet: loaded.wallet,
        bundleLamports,
        curve,
        successUrl,
      }),
    );
  }

  /** Every `lc` click after the entry checks the plan first (§8): it can end mid-flow. */
  const guarded =
    (handler: CallbackHandler): CallbackHandler =>
    async (ctx, args) =>
      (await requireSubscription(ctx)) ? handler(ctx, args) : undefined;

  tokenStep.registerFlow({
    flow: "LAUNCH",
    backData: LAUNCH_CB.bundleStep,
    // §5, §15: the choices already made, above the TOKEN block, when the step draws itself.
    summaryLines: async (ctx) => {
      const state = stateOf(ctx);
      const wallet = walletIn(await data.getUserBalances(ctx.user.id), state.walletId);
      return launchSummaryLines(wallet, lamportsOf(state.bundleLamports));
    },
    onContinue: showRecap,
  });
  inputs.register("launch_amount", amountInput);
  // « I've joined » verified on the channel screen: the check is not made twice (§4.2).
  access.registerResume("launch", startLaunch);

  router.register("lc", {
    // The entry (§4.2): the channel checked without cache, then the flow.
    open: async (ctx) =>
      (await access.ensureChannelMembership(ctx, { mode: "fresh", resume: "launch" }))
        ? startLaunch(ctx)
        : undefined,
    w: guarded((ctx, [walletId]) => chooseWallet(ctx, walletId ?? "")),
    s1: guarded((ctx) => {
      delete stateOf(ctx).blockedLamports;
      return showWalletStep(ctx);
    }),
    s2: guarded((ctx) => {
      delete stateOf(ctx).blockedLamports;
      return showBundleStep(ctx);
    }),
    s3: guarded(showLaunchToken),
    b: guarded(async (ctx, [arg]) => {
      if (arg === "c") return showCustom(ctx);
      if (arg === "cx") return showBundleStep(ctx);
      if (arg === "r") return notifyIfUnchanged(ctx, await showBundleStep(ctx, { refresh: true }));
      const lamports = bundlePresetLamports(arg);
      return lamports === null ? notify(ctx, en.common.staleButton) : choosePreset(ctx, lamports);
    }),
    // D6: nothing is written, nothing is signed; the recap already says it.
    create: guarded((ctx) => notify(ctx, en.launch.recap.v2Notice, { alert: true })),
  });
}
