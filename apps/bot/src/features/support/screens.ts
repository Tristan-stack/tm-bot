import {
  buildSupportCode,
  buildSupportUrl,
  cbBtn,
  code,
  en,
  getPlanFeatures,
  NAV_HOME,
  renderScreen,
  SUPPORT_PREFILL_ENABLED,
  urlBtn,
} from "@launchbot/shared";
import type { Plan, Screen, Ui } from "@launchbot/shared";

export type SupportModel = {
  /** The plan active now; `null` without one (never subscribed, or expired). */
  plan: Plan | null;
  telegramId: bigint;
  /** `SUPPORT_URL`: the account the Terms and the Privacy Policy name too (V1-41). */
  supportUrl: string;
};

/**
 * The Support screen (§11.1): how to reach the human support, the support code (the letter of
 * the plan of now, then the Telegram id) alone in <code> so a tap copies it, and the priority
 * line of Premium (§8.1).
 */
export function buildSupportScreen(ui: Ui, model: SupportModel): Screen {
  const supportCode = buildSupportCode(model.plan, model.telegramId);
  const priority = getPlanFeatures(model.plan).prioritySupport;
  const contactUrl = buildSupportUrl(model.supportUrl, supportCode, {
    prefill: SUPPORT_PREFILL_ENABLED,
  });
  return renderScreen({
    header: ui.screenHeader(en.support.title),
    description: [...en.support.description],
    info: [
      [en.support.code(code(supportCode)), en.support.pasteHint].join("\n"),
      priority ? en.support.premium : en.support.standard,
    ].join("\n\n"),
    keyboard: [[urlBtn(en.support.btnContact, contactUrl)], [cbBtn(en.btn.back, NAV_HOME)]],
  });
}
