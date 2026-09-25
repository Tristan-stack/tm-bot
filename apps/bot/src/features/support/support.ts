import type { Ui } from "@launchbot/shared";
import { showScreen } from "../../navigation/show-screen.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import type { DataServices } from "../../services/data.js";
import { buildSupportScreen } from "./screens.js";

export type SupportDeps = {
  ui: Ui;
  /** Read at every display, never cached (§15): the code says the plan of now. */
  data: Pick<DataServices, "getPlanStatus">;
  supportUrl: string;
};

/** « 🆘 Support » of the main menu (`sup:open`, V1-40): it replaces the provisional screen of V1-08. */
export function registerSupport(router: CallbackRouter, deps: SupportDeps): void {
  const { ui, data, supportUrl } = deps;
  router.register("sup", {
    open: async (ctx) => {
      // ACTIVE with an end still ahead (§8.1): a plan past its end the worker has not expired
      // yet gives `F`, as on the home screen.
      const status = await data.getPlanStatus(ctx.user.id);
      const plan = status.kind === "ACTIVE" ? status.subscription.plan : null;
      await showScreen(
        ctx,
        buildSupportScreen(ui, { plan, telegramId: ctx.user.telegramId, supportUrl }),
      );
    },
  });
}
