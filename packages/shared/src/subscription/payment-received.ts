import { LAUNCH_COIN, NAV_HOME } from "../callback.js";
import type { Plan } from "../constants.js";
import { formatDateTime } from "../format/date.js";
import { en } from "../i18n/en.js";
import type { Ui } from "../ui/index.js";
import { cbBtn, renderScreen } from "../ui/screen.js";
import type { Screen } from "../ui/screen.js";

/**
 * « Payment received » (§8.3): the screen the bot edits after « I've paid » or a payment from a
 * bot wallet (V1-30, V1-31), and the message the worker sends when it activates (V1-32), which
 * knows only the plan and its end. Here, not in the bot, so both draw the same screen.
 */
export function buildPaymentReceivedScreen(ui: Ui, paid: { plan: Plan; expiresAt: Date }): Screen {
  return renderScreen({
    header: ui.screenHeader(en.subscribe.title),
    // The final end of the plan, after an extension.
    info: en.subscribe.paymentReceived(en.plans[paid.plan], formatDateTime(paid.expiresAt)),
    keyboard: [[cbBtn(en.menu.launchCoin, LAUNCH_COIN), cbBtn(en.btn.menu, NAV_HOME)]],
  });
}
