import { en, NAV_HOME, parseBundleAmount } from "@launchbot/shared";
import type { Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { BotContext, SimFlowState } from "../../context.js";
import type { InputHandler, InputRouter } from "../../navigation/inputs.js";
import { notify } from "../../navigation/notify.js";
import { presentScreen, showScreen } from "../../navigation/show-screen.js";
import type { PresentOptions, ShowMode } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import type { SimulationService } from "../../services/simulation.js";
import type { ReadyTokenDraft, TokenStep } from "../token-step/token-step.js";
import { createLiveHandlers } from "./live.js";
import type { LiveDeps } from "./live.js";
import { buildBundleScreen, buildCustomAmountScreen, buildRecapScreen } from "./screens.js";

const log = createLogger("bot:simulation");

export type SimulationFlowDeps = LiveDeps & {
  ui: Ui;
  tokenStep: TokenStep;
  simulations: SimulationService;
};

/** The draft in hand spares the read; without it the step reads it, or shows the Missing flag. */
type Options = Omit<PresentOptions, "input" | "withdraw"> & { draft?: ReadyTokenDraft };

/**
 * Simulate a Launch (§6, V1-22): the menu opens the Token step (V1-16, Back is the menu),
 * Continue leads to the Bundle (the dev buy is a fixed 1 SOL, decision of 25/09/2026), a preset
 * or a Custom amount to the recap, whose Start simulation runs the Simulation created for it in
 * the chat (D14, D21, V1-26). The bundle lives in the session, the draft in the state of the
 * Token step.
 */
export function registerSimulation(
  router: CallbackRouter,
  inputs: InputRouter,
  deps: SimulationFlowDeps,
): void {
  const { ui, tokenStep, simulations } = deps;
  const stateOf = (ctx: BotContext): SimFlowState => (ctx.session.sim ??= {});

  const draftOf = (ctx: BotContext, options: Options): Promise<ReadyTokenDraft | null> =>
    options.draft === undefined
      ? tokenStep.requireReadyDraft(ctx, "SIMULATION", { mode: options.mode })
      : Promise.resolve(options.draft);

  async function showBundle(ctx: BotContext, options: Options = {}): Promise<void> {
    const draft = await draftOf(ctx, options);
    if (draft === null) return;
    const view = { draft, bundleSol: stateOf(ctx).bundleSol };
    await presentScreen(ctx, (flags) => buildBundleScreen(ui, view, { flags }), options);
  }

  async function showCustom(ctx: BotContext, options: Options = {}): Promise<void> {
    const draft = await draftOf(ctx, options);
    if (draft === null) return;
    const view = { draft, bundleSol: stateOf(ctx).bundleSol };
    await presentScreen(ctx, (flags) => buildCustomAmountScreen(ui, view, { flags }), {
      ...options,
      input: { kind: "sim_amount" },
    });
  }

  /**
   * A bundle chosen (§6): the Simulation is created or found again while the recap is built
   * (D14); Start simulation runs that row (V1-26).
   */
  async function chooseBundle(ctx: BotContext, bundleSol: number, mode?: ShowMode): Promise<void> {
    const draft = await draftOf(ctx, { mode });
    if (draft === null) return;
    stateOf(ctx).bundleSol = bundleSol;

    let result;
    try {
      result = await simulations.prepare({
        userId: ctx.user.id,
        telegramId: Number(ctx.user.telegramId),
        draft,
        bundleSol,
      });
    } catch (error) {
      log.error({ err: error, userId: ctx.user.id }, "Simulation not prepared");
      const generic = { alert: en.common.genericError, flag: en.common.genericError };
      return showBundle(ctx, { mode, draft, block: generic });
    }
    if (result.kind === "rate_limited") {
      return showBundle(ctx, { mode, draft, block: en.sim.rateLimited });
    }
    await showScreen(
      ctx,
      buildRecapScreen(ui, { draft, config: result.config, simId: result.simId }),
      { mode },
    );
  }

  const amountInput: InputHandler<"sim_amount"> = async (ctx, _pending, text) => {
    const mode = "edit";
    const parsed = parseBundleAmount(text ?? "");
    if (!parsed.ok) return showCustom(ctx, { mode, flags: [en.sim.custom.invalid] });
    await chooseBundle(ctx, parsed.sol, mode);
  };

  tokenStep.registerFlow({
    flow: "SIMULATION",
    backData: NAV_HOME,
    onContinue: (ctx, draft) => showBundle(ctx, { draft }),
  });
  inputs.register("sim_amount", amountInput);
  router.register("sim", {
    ...createLiveHandlers(deps),
    open: (ctx) => tokenStep.showTokenStep(ctx, "SIMULATION"),
    b: (ctx, [arg]) => {
      if (arg === "c") return showCustom(ctx);
      const parsed = parseBundleAmount(arg ?? "");
      return parsed.ok ? chooseBundle(ctx, parsed.sol) : notify(ctx, en.common.staleButton);
    },
    cc: (ctx) => showBundle(ctx),
    bk: (ctx, [target]) =>
      target === "tok"
        ? tokenStep.showTokenStep(ctx, "SIMULATION")
        : target === "b"
          ? showBundle(ctx)
          : notify(ctx, en.common.staleButton),
  });
}
