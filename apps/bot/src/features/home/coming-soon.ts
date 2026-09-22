import { en, NAV_HOME, navRow, renderScreen } from "@launchbot/shared";
import type { CallbackDomain, Screen, Ui } from "@launchbot/shared";
import type { BotContext } from "../../context.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";

export type ComingSoonSection = keyof typeof en.comingSoon.sections;

/** §4.5: never buttons alone, even on a screen that only says the section is not there yet. */
export const buildComingSoonScreen = (ui: Ui, section: ComingSoonSection): Screen =>
  renderScreen({
    header: ui.screenHeader(en.comingSoon.sections[section].title),
    description: en.comingSoon.sections[section].description,
    flags: [en.comingSoon.flag],
    keyboard: [navRow(NAV_HOME)],
  });

/**
 * The provisional screen of a section. A ticket also shows it for a button it leaves to a
 * later ticket (V1-10, V1-29, V1-30…).
 */
export async function showComingSoon(
  ctx: BotContext,
  ui: Ui,
  section: ComingSoonSection,
): Promise<void> {
  await showScreen(ctx, buildComingSoonScreen(ui, section));
}

/** The sections of the main menu, by the router domain their ticket will take. */
const SECTIONS: [CallbackDomain, ComingSoonSection][] = [
  ["lc", "launch"], // V1-35
  ["sim", "simulate"], // V1-16, then V1-22
  ["sub", "subscribe"], // V1-29
  ["wal", "wallets"], // V1-10
  ["sup", "support"], // V1-40
];

/** Provisional: the `router.register` of a section replaces its line, with nothing to edit here. */
export function registerComingSoon(router: CallbackRouter, ui: Ui): void {
  for (const [domain, section] of SECTIONS) {
    router.registerProvisional(domain, (ctx) => showComingSoon(ctx, ui, section));
  }
}
