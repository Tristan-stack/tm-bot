import {
  en,
  encodeCallback,
  escapeHtml,
  formatTicker,
  NAV_HOME,
  navRow,
  renderScreen,
} from "@launchbot/shared";
import type { Screen, Ui } from "@launchbot/shared";
import { showScreen } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import type { TokenStep } from "../token-step/token-step.js";

/** The button of the menu (V1-08), and the Back of step 2 to the Token screen. */
export const SIM_CB = { open: encodeCallback("sim", "open") } as const;

/** Step 2 of a simulation until V1-22 delivers the dev buy (§4.5: never buttons alone). */
export const buildDevBuySoonScreen = (ui: Ui, draft: { name: string; symbol: string }): Screen =>
  renderScreen({
    header: ui.flowHeader({ flow: "SIMULATION", step: 2 }),
    description: [
      en.token.devBuySoon.token(escapeHtml(draft.name), formatTicker(draft.symbol)),
      en.token.devBuySoon.description,
    ],
    keyboard: [navRow(SIM_CB.open, { menu: true })],
  });

/**
 * Provisional Simulate a Launch (V1-16): the menu opens the Token step, whose Back is the
 * menu (`nav:home`, edited in place like every Back) and whose Continue shows step 2 as coming
 * soon. V1-22 replaces this file.
 */
export function registerSimulationProvisional(
  router: CallbackRouter,
  ui: Ui,
  tokenStep: TokenStep,
): void {
  tokenStep.registerFlow({
    flow: "SIMULATION",
    backData: NAV_HOME,
    onContinue: (ctx, draft) => showScreen(ctx, buildDevBuySoonScreen(ui, draft)),
  });

  router.register("sim", { open: (ctx) => tokenStep.showTokenStep(ctx, "SIMULATION") });
}
