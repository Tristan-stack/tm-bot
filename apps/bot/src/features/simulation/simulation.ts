import { en, NAV_HOME, parseDevBuyAmount } from "@launchbot/shared";
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
import { buildCustomAmountScreen, buildDevBuyScreen, buildRecapScreen } from "./screens.js";

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
 * Continue leads to the Dev buy, a preset or a Custom amount to the recap, whose Start
 * simulation runs the Simulation created for it in the chat (D14, D21, V1-26). The dev buy
 * lives in the session, the draft in the state of the Token step.
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

  async function showDevBuy(ctx: BotContext, options: Options = {}): Promise<void> {
    const draft = await draftOf(ctx, options);
    if (draft === null) return;
    const view = { draft, devBuySol: stateOf(ctx).devBuySol };
    await presentScreen(ctx, (flags) => buildDevBuyScreen(ui, view, { flags }), options);
  }

  async function showCustom(ctx: BotContext, options: Options = {}): Promise<void> {
    const draft = await draftOf(ctx, options);
    if (draft === null) return;
    const view = { draft, devBuySol: stateOf(ctx).devBuySol };
    await presentScreen(ctx, (flags) => buildCustomAmountScreen(ui, view, { flags }), {
      ...options,
      input: { kind: "sim_amount" },
    });
  }

  /**
   * A dev buy chosen (§6): the Simulation is created or found again while the recap is built
   * (D14); Start simulation runs that row (V1-26).
   */
  async function chooseDevBuy(ctx: BotContext, devBuySol: number, mode?: ShowMode): Promise<void> {
    const draft = await draftOf(ctx, { mode });
    if (draft === null) return;
    stateOf(ctx).devBuySol = devBuySol;

    let result;
    try {
      result = await simulations.prepare({
        userId: ctx.user.id,
        telegramId: Number(ctx.user.telegramId),
        draft,
        devBuySol,
      });
    } catch (error) {
      log.error({ err: error, userId: ctx.user.id }, "Simulation not prepared");
      const generic = { alert: en.common.genericError, flag: en.common.genericError };
      return showDevBuy(ctx, { mode, draft, block: generic });
    }
    if (result.kind === "rate_limited") {
      return showDevBuy(ctx, { mode, draft, block: en.sim.rateLimited });
    }
    await showScreen(
      ctx,
      buildRecapScreen(ui, {
        draft,
        devBuySol,
        curve: result.config.curve,
        simId: result.simId,
      }),
      { mode },
    );
  }

  const amountInput: InputHandler<"sim_amount"> = async (ctx, _pending, text) => {
    const mode = "edit";
    const parsed = parseDevBuyAmount(text ?? "");
    if (!parsed.ok) return showCustom(ctx, { mode, flags: [en.sim.custom.invalid] });
    await chooseDevBuy(ctx, parsed.sol, mode);
  };

  tokenStep.registerFlow({
    flow: "SIMULATION",
    backData: NAV_HOME,
    onContinue: (ctx, draft) => showDevBuy(ctx, { draft }),
  });
  inputs.register("sim_amount", amountInput);
  router.register("sim", {
    ...createLiveHandlers(deps),
    open: (ctx) => tokenStep.showTokenStep(ctx, "SIMULATION"),
    dev: (ctx, [arg]) => {
      if (arg === "c") return showCustom(ctx);
      const parsed = parseDevBuyAmount(arg ?? "");
      return parsed.ok ? chooseDevBuy(ctx, parsed.sol) : notify(ctx, en.common.staleButton);
    },
    cc: (ctx) => showDevBuy(ctx),
    bk: (ctx, [target]) =>
      target === "tok"
        ? tokenStep.showTokenStep(ctx, "SIMULATION")
        : target === "dev"
          ? showDevBuy(ctx)
          : notify(ctx, en.common.staleButton),
  });
}
