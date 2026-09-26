import type {
  LaunchFundingService,
  LaunchSweepService,
  UserBalances,
  WalletBalance,
} from "@launchbot/db";
import {
  BUNDLE_MIN_LAMPORTS,
  bundlePresetLamports,
  customMaxLamports,
  en,
  escapeHtml,
  lamportsToSol,
  launchShortfallLamports,
  launchSpendLamports,
  parseLaunchBundleInput,
  smallestLaunchShortfall,
  warn,
} from "@launchbot/shared";
import type { OptionalLine, Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { BotContext, LaunchFlowState } from "../../context.js";
import { mayReadFreshBalances } from "../../middleware/rate-limit.js";
import { newConfirmToken } from "../../navigation/confirm-token.js";
import type { InputHandler, InputRouter } from "../../navigation/inputs.js";
import { acknowledge, notify } from "../../navigation/notify.js";
import { notifyIfUnchanged, presentScreen, showScreen } from "../../navigation/show-screen.js";
import type { PresentOptions, ShowMode, ShowResult } from "../../navigation/show-screen.js";
import type { CallbackHandler, CallbackRouter } from "../../router/callback-router.js";
import type { DataServices } from "../../services/data.js";
import type { SimulationService } from "../../services/simulation.js";
import type { Access } from "../access/access.js";
import type { SimStarter } from "../simulation/live.js";
import type { Subscribe } from "../subscribe/subscribe.js";
import type { ReadyTokenDraft, TokenStep } from "../token-step/token-step.js";
import { txFailureText } from "../wallets/withdraw-screens.js";
import {
  buildBundleStepScreen,
  buildLaunchCustomScreen,
  buildLaunchFundedScreen,
  buildLaunchFundingFailedScreen,
  buildLaunchFundingScreen,
  buildLaunchRecapScreen,
  buildWalletStepScreen,
  insufficientWalletNote,
  LAUNCH_CB,
  launchSummaryLines,
} from "./screens.js";
import type { LaunchFundedView } from "./screens.js";

const log = createLogger("bot:launch");

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
  /** Create token (decision of 26/09/2026): the dev buy and the bundle to a launch wallet. */
  launchFunding: LaunchFundingService;
  /** `LAUNCH_TEST_DIVISOR`: 1, or what the dev buy and the bundle are divided by (devnet). */
  launchDivisor: bigint;
  /** The chart of the launch: a Simulation of this coin, run in the chat (§6). */
  simulations: Pick<SimulationService, "prepareLaunch">;
  startSim: SimStarter;
  /** Once the chart is over, what the launch wallet holds goes to the treasury. */
  launchSweep: Pick<LaunchSweepService, "sweepLaunchWallet">;
};

type Show = Pick<PresentOptions, "mode" | "flags">;
/** The wallet of the flow with the balances it was found in: one read per screen. */
type Loaded = { wallet: WalletBalance; balances: UserBalances };
/** The wallet of the flow and its balance, read: what an amount is checked against. */
type Funded = Loaded & { balance: bigint };
/** The wallet of the flow and the bundle chosen for it: what the recap and Create token need. */
type Chosen = Loaded & { bundleLamports: bigint };

const walletIn = (balances: UserBalances, walletId: string | undefined) =>
  balances.wallets.find((wallet) => wallet.id === walletId);

/**
 * Launch Coin (§10.1, V1-35 to V1-37): the channel checked without cache and an active plan at
 * the entry, then Wallet → Bundle → Token → Recap; the dev buy is a fixed 1 SOL and the bundle
 * leaves the same wallet (decision of 25/09/2026). No token is created yet (D6): Create token
 * moves the dev buy and the bundle to a fresh launch wallet (decision of 26/09/2026). The state
 * is in the session (`launch`), the draft in the Token step.
 */
export function registerLaunch(
  router: CallbackRouter,
  inputs: InputRouter,
  deps: LaunchFlowDeps,
): void {
  const { ui, data, access, tokenStep, offers, successUrl, launchFunding } = deps;
  const { simulations, startSim, launchSweep } = deps;
  const divisor = deps.launchDivisor;
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
    return presentScreen(
      ctx,
      (flags) => buildWalletStepScreen(ui, wallets, { flags, divisor }),
      show,
    );
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
    const shortfall = smallestLaunchShortfall(wallet.lamports, divisor);
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
      launchShortfallLamports(balance, blocked, divisor) === 0n
    ) {
      delete state.blockedLamports;
    }
    const view = {
      wallet: loaded.wallet,
      solUsd,
      bundleLamports: lamportsOf(state.bundleLamports),
      blockedLamports: lamportsOf(state.blockedLamports),
      refreshedAt: refresh ? loaded.balances.fetchedAt : undefined,
      divisor,
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
    return launchShortfallLamports(funded.balance, lamports, divisor) > 0n
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
    const maxLamports = customMaxLamports(funded.balance, divisor);
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
    const parsed = parseLaunchBundleInput(text ?? "", funded.balance, divisor);
    if (parsed.ok) {
      await chooseBundle(ctx, funded.wallet, parsed.lamports, mode);
    } else if (parsed.reason === "invalid") {
      await showCustom(ctx, { funded, mode, flags: [en.sim.custom.invalid] });
    } else {
      await refuseAmount(ctx, funded, parsed.lamports, mode);
    }
  };

  /** The wallet and the bundle of the flow, still there; else the step that chooses them. */
  async function launchChoices(ctx: BotContext): Promise<Chosen | null> {
    const loaded = await launchWallet(ctx);
    if (loaded === null) return null;
    const bundleLamports = lamportsOf(stateOf(ctx).bundleLamports);
    if (bundleLamports !== undefined) return { ...loaded, bundleLamports };
    await showBundleStep(ctx, { loaded });
    return null;
  }

  /** Step 3 again (Back of the recap): the wallet and the bundle must still be there. */
  async function showLaunchToken(ctx: BotContext): Promise<unknown> {
    const chosen = await launchChoices(ctx);
    if (chosen === null) return;
    return tokenStep.showTokenStep(ctx, "LAUNCH", {
      summaryLines: launchSummaryLines(chosen.wallet, chosen.bundleLamports),
    });
  }

  /**
   * Step 4/4 (§10.1), from Continue on a token with its name and ticker: the plan, the wallet
   * and the bundle are checked again; whatever is missing sends back to its step. Every recap
   * carries a new token on its Create token button.
   */
  async function showRecap(
    ctx: BotContext,
    draft: ReadyTokenDraft,
    options: { flags?: OptionalLine[] } = {},
  ): Promise<unknown> {
    if (!(await requireSubscription(ctx))) return;
    const [chosen, { curve }] = await Promise.all([launchChoices(ctx), data.getCurveParams()]);
    if (chosen === null) return;
    const createToken = newConfirmToken();
    stateOf(ctx).createToken = createToken;
    return showScreen(
      ctx,
      buildLaunchRecapScreen(
        ui,
        {
          draft,
          wallet: chosen.wallet,
          bundleLamports: chosen.bundleLamports,
          curve,
          successUrl,
          createToken,
          divisor,
        },
        options,
      ),
    );
  }

  /**
   * Create token (decision of 26/09/2026): the token of the recap spent first — a second click
   * on the same recap is a stale button — then the draft, the wallet and the bundle checked
   * again, and the dev buy and the bundle move to a fresh launch wallet, fees included. The
   * screen says it is sending meanwhile, without a button (§9.5).
   */
  /** In the background, logged: the chart is over, the launch wallet goes to the treasury. */
  function sweep(userId: string, walletId: string): void {
    launchSweep.sweepLaunchWallet(walletId).then(
      (outcome) => log.info({ userId, walletId, status: outcome.status }, "launch.chart_sweep"),
      (error: unknown) => log.error({ err: error, userId, walletId }, "launch.chart_sweep_failed"),
    );
  }

  /**
   * The chart of the launch (decision of 26/09/2026): a Simulation of this coin, its dev buy and
   * its bundle in product amounts, runs under the funded screen, as if the coin were live. Its
   * end sweeps the launch wallet; a chart that cannot start sweeps it at once, with why on the
   * funded screen. The worker sweeps whatever a restart left behind.
   */
  async function runChart(
    ctx: BotContext,
    draft: ReadyTokenDraft,
    funded: LaunchFundedView,
    bundleLamports: bigint,
  ): Promise<unknown> {
    const userId = ctx.user.id;
    const walletId = funded.launchWallet.id;
    try {
      const { simId, config } = await simulations.prepareLaunch({
        userId,
        draft,
        bundleSol: lamportsToSol(bundleLamports),
      });
      const refused = await startSim(ctx, {
        simId,
        config,
        token: draft,
        flow: "LAUNCH",
        onEnd: () => sweep(userId, walletId),
      });
      if (refused === null) return;
      sweep(userId, walletId);
      return showScreen(ctx, buildLaunchFundedScreen(ui, funded, { flags: [refused.flag] }));
    } catch (error) {
      log.error({ err: error, userId }, "launch.chart_failed");
      sweep(userId, walletId);
    }
  }

  async function create(ctx: BotContext, token: string | undefined): Promise<unknown> {
    const state = stateOf(ctx);
    if (token === undefined || token !== state.createToken) {
      return notify(ctx, en.common.staleButton);
    }
    const draft = await tokenStep.requireReadyDraft(ctx, "LAUNCH");
    if (draft === null) return;
    const chosen = await launchChoices(ctx);
    if (chosen === null) return;
    delete state.createToken;
    await acknowledge(ctx);

    const { wallet } = chosen;
    // Computed once: what the screen says leaves the wallet is what the service sends.
    const debitLamports = launchSpendLamports(chosen.bundleLamports, divisor);
    await showScreen(ctx, buildLaunchFundingScreen(ui, { wallet, debitLamports }));
    const outcome = await launchFunding.fund({
      userId: ctx.user.id,
      walletId: wallet.id,
      debitLamports,
      symbol: draft.symbol,
    });
    switch (outcome.status) {
      case "funded": {
        const funded: LaunchFundedView = {
          draft,
          wallet,
          launchWallet: outcome.launchWallet,
          withdrawal: outcome.withdrawal,
        };
        await showScreen(ctx, buildLaunchFundedScreen(ui, funded));
        return runChart(ctx, draft, funded, chosen.bundleLamports);
      }
      case "failed":
        return showScreen(ctx, buildLaunchFundingFailedScreen(ui, outcome));
      case "refused":
        // Nothing left the wallet: the recap again, with the balance of now and why.
        return showRecap(ctx, draft, { flags: [warn(txFailureText(outcome.failure)).flag] });
      case "in_progress":
        return showRecap(ctx, draft, { flags: [en.launch.funding.inProgress] });
      case "not_found":
        return showWalletStep(ctx, { flags: [en.launch.wallet.gone] });
    }
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
    // D6: no token yet; the dev buy and the bundle go to a launch wallet (26/09/2026).
    create: guarded((ctx, [token]) => create(ctx, token)),
  });
}
