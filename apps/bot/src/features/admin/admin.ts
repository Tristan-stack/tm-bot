import type {
  AccountDeletionService,
  SensitiveMessageStore,
  SubscriptionService,
  SupportDataService,
} from "@launchbot/db";
import { en } from "@launchbot/shared";
import type { Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { KeyVault } from "@launchbot/solana";
import type { Api } from "grammy";
import { notify } from "../../navigation/notify.js";
import { telegramErrorFields } from "../../navigation/telegram-errors.js";
import type { CallbackRouter } from "../../router/callback-router.js";
import type { DataServices } from "../../services/data.js";
import { createAdminKit } from "./common.js";
import { createGrant } from "./grant.js";
import { ADMIN_COMMANDS } from "./guard.js";
import type { AdminGuard } from "./guard.js";
import { createPurge } from "./purge.js";
import { createReveal } from "./reveal.js";
import { createUserData } from "./user-data.js";

const log = createLogger("bot:admin");

/** What the admin commands read and write (V1-42 to V1-44): the tests give fakes. */
export type AdminServices = {
  subscriptions: Pick<SubscriptionService, "previewGrant" | "confirmGrant" | "isGrantUsed">;
  support: SupportDataService;
  deletion: Pick<AccountDeletionService, "getPurgeSummary" | "deleteUserData">;
  sensitive: Pick<SensitiveMessageStore, "schedule">;
};

export type AdminDeps = AdminServices & {
  ui: Ui;
  guard: AdminGuard;
  data: Pick<DataServices, "getUserBalances" | "getSolUsdPrice" | "invalidateUserBalances">;
  /** The one vault of the process: Reveal keys decrypts with it. */
  vault: KeyVault;
  now?: () => Date;
};

/**
 * The admin commands of §11.4 on the guard of V1-38: /grant (V1-42), /whois and /getall (V1-43),
 * /purge (V1-44), and their buttons `adm:*`, which the guard lets through to the router for an
 * admin only.
 */
export function registerAdmin(router: CallbackRouter, deps: AdminDeps): void {
  const { ui, guard, support, data, now = () => new Date() } = deps;
  const kit = createAdminKit({ ui, findUser: support.findUser });
  const grant = createGrant({
    kit,
    subscriptions: deps.subscriptions,
    findUserById: support.findUserById,
    now,
  });
  const userData = createUserData({ kit, support, data, now });
  const reveal = createReveal({ kit, support, sensitive: deps.sensitive, vault: deps.vault, now });
  const purge = createPurge({ kit, deletion: deps.deletion, data, now });

  guard.commands.command("grant", grant.command);
  guard.commands.command("whois", userData.whois);
  guard.commands.command("getall", userData.getall);
  guard.commands.command("purge", purge.command);

  router.register("adm", {
    grant: grant.callback,
    ga: (ctx, [action, nonce]) => {
      if (nonce === undefined) return notify(ctx, en.common.staleButton);
      if (action === "rev") return reveal.reveal(ctx, nonce);
      if (action === "no") return reveal.cancel(ctx, nonce);
      return notify(ctx, en.common.staleButton);
    },
    prg: purge.callback,
  });
}

/**
 * Proposal of V1-38: the commands of the registry in the menu of each admin, in their chat only,
 * never in the default list. An admin who never opened the bot cannot get one: a warning.
 */
export async function setAdminCommands(
  api: Pick<Api, "setMyCommands">,
  adminIds: readonly number[],
): Promise<void> {
  const commands = [
    { command: "start", description: en.home.command },
    ...ADMIN_COMMANDS.map((name) => ({
      command: name,
      description: en.admin.commands[name].menu,
    })),
  ];
  await Promise.all(
    adminIds.map(async (adminId) => {
      try {
        await api.setMyCommands(commands, { scope: { type: "chat", chat_id: adminId } });
      } catch (error) {
        log.warn({ adminId, ...telegramErrorFields(error) }, "admin.commands_not_set");
      }
    }),
  );
}
