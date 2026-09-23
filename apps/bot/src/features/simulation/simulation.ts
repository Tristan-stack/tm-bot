import { en, missingRequiredFields, NAV_HOME, parseDevBuyAmount } from "@launchbot/shared";
import type { OptionalLine, Screen, Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { Env } from "@launchbot/shared/server";
import type { BotContext, SimFlowState } from "../../context.js";
import type { InputHandler, InputRouter } from "../../navigation/inputs.js";
import { notify } from "../../navigation/notify.js";
import { blockWithFlag, showScreen } from "../../navigation/show-screen.js";
import type { Block, ShowMode } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import type { SimulationService } from "../../services/simulation.js";
import type { ReadyTokenDraft, TokenStep } from "../token-step/token-step.js";
import { buildCustomAmountScreen, buildDevBuyScreen, buildRecapScreen } from "./screens.js";

const log = createLogger("bot:simulation");

export type SimulationFlowDeps = {
  ui: Ui;
  env: Pick<Env, "WEBAPP_URL">;
  tokenStep: TokenStep;
  simulations: SimulationService;
};

type Options = { mode?: ShowMode; flags?: OptionalLine[]; block?: Block };

/**
 * Simulate a Launch (§6, V1-22): the menu opens the Token step (V1-16, Back is the menu),
 * Continue leads to the Dev buy, a preset or a Custom amount to the recap, whose Start
 * simulation is a `web_app` button on the Simulation created for it (D14). The dev buy lives
 * in the session, the draft in the state of the Token step.
 */
export function registerSimulation(
  router: CallbackRouter,
  inputs: InputRouter,
  { ui, env, tokenStep, simulations }: SimulationFlowDeps,
): void {
  const stateOf = (ctx: BotContext): SimFlowState => (ctx.session.sim ??= {});

  /** The draft with its name and ticker, or the Token screen with the "Missing" flag. */
  async function readyDraft(ctx: BotContext, mode?: ShowMode): Promise<ReadyTokenDraft | null> {
    const draft = await tokenStep.loadDraft(ctx, "SIMULATION");
    const missing = draft === null ? (["name", "ticker"] as const) : missingRequiredFields(draft);
    if (draft !== null && missing.length === 0) return draft as ReadyTokenDraft;
    await tokenStep.showTokenStep(ctx, "SIMULATION", {
      mode,
      flags: [en.token.missing(missing.map((field) => en.token.fieldLabels[field]))],
    });
    return null;
  }

  const present = (
    ctx: BotContext,
    render: (flags: OptionalLine[]) => Screen,
    options: Options & { input?: "sim_amount" } = {},
  ): Promise<unknown> =>
    options.block === undefined
      ? showScreen(ctx, render(options.flags ?? []), {
          mode: options.mode,
          input: options.input === undefined ? undefined : { kind: options.input },
        })
      : blockWithFlag(ctx, options.block, (flag) => render([flag]), { mode: options.mode });

  async function showDevBuy(ctx: BotContext, options: Options = {}): Promise<void> {
    const draft = await readyDraft(ctx, options.mode);
    if (draft === null) return;
    const view = { draft, devBuySol: stateOf(ctx).devBuySol };
    await present(ctx, (flags) => buildDevBuyScreen(ui, view, { flags }), options);
  }

  async function showCustom(ctx: BotContext, options: Options = {}): Promise<void> {
    const draft = await readyDraft(ctx, options.mode);
    if (draft === null) return;
    const view = { draft, devBuySol: stateOf(ctx).devBuySol };
    await present(ctx, (flags) => buildCustomAmountScreen(ui, view, { flags }), {
      ...options,
      input: "sim_amount",
    });
  }

  /**
   * A dev buy chosen (§6): the Simulation is created or found again while the recap is built,
   * not when Start simulation is tapped (D14: a `web_app` button never reaches the bot).
   */
  async function chooseDevBuy(ctx: BotContext, devBuySol: number, mode?: ShowMode): Promise<void> {
    const draft = await readyDraft(ctx, mode);
    if (draft === null) return;
    stateOf(ctx).devBuySol = devBuySol;

    let result;
    try {
      result = await simulations.prepare({
        userId: ctx.user.id,
        telegramId: Number(ctx.user.telegramId),
        draftId: draft.id,
        devBuySol,
      });
    } catch (error) {
      log.error({ err: error, userId: ctx.user.id }, "Simulation not prepared");
      const generic = { alert: en.common.genericError, flag: en.common.genericError };
      return showDevBuy(ctx, { mode, block: generic });
    }

    switch (result.kind) {
      case "ok":
        return void (await showScreen(
          ctx,
          buildRecapScreen(ui, {
            draft,
            devBuySol,
            curve: result.config.curve,
            simId: result.simId,
            webAppUrl: env.WEBAPP_URL,
          }),
          { mode },
        ));
      case "rate_limited":
        return showDevBuy(ctx, { mode, block: en.sim.rateLimited });
      case "missing_fields":
        // The draft went away between the read above and the service (a purge, V1-45).
        return void (await readyDraft(ctx, mode));
    }
  }

  const amountInput: InputHandler<"sim_amount"> = async (ctx, _pending, text) => {
    const mode = "edit";
    const parsed = text === undefined ? { ok: false as const } : parseDevBuyAmount(text);
    if (!parsed.ok) return showCustom(ctx, { mode, flags: [en.sim.custom.invalid] });
    await chooseDevBuy(ctx, parsed.sol, mode);
  };

  tokenStep.registerFlow({
    flow: "SIMULATION",
    backData: NAV_HOME,
    onContinue: (ctx) => showDevBuy(ctx),
  });
  inputs.register("sim_amount", amountInput);
  router.register("sim", {
    open: (ctx) => tokenStep.showTokenStep(ctx, "SIMULATION"),
    dev: (ctx, [arg]) => {
      if (arg === "c") return showCustom(ctx);
      const sol = Number(arg);
      return parseDevBuyAmount(String(sol)).ok
        ? chooseDevBuy(ctx, sol)
        : notify(ctx, en.common.staleButton);
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
