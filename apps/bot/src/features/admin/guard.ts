import { decodeCallback, en } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { Composer, Context } from "grammy";
import type { MiddlewareFn } from "grammy";
import type { BotContext } from "../../context.js";
import { isCommand } from "../../navigation/inputs.js";
import type { InputKind } from "../../navigation/inputs.js";

const log = createLogger("bot:admin");

/** The inputs only an admin is asked for (/announce, V1-38): their messages meet the guard. */
const ADMIN_INPUTS: ReadonlySet<InputKind> = new Set(["announce"]);

/** The message an admin input waits for: what the input router would hand to it. */
function isAdminInput(ctx: BotContext): boolean {
  const pending = ctx.session.pendingInput;
  return (
    pending !== undefined &&
    ADMIN_INPUTS.has(pending.kind) &&
    ctx.message !== undefined &&
    !isCommand(ctx.message)
  );
}

/** A command of the registry of en.ts (`en.admin.commands`, V1-38): each ticket adds its own. */
export type AdminCommandName = keyof typeof en.admin.commands;
export const ADMIN_COMMANDS = Object.keys(en.admin.commands) as AdminCommandName[];

/** grammY's own matchers, those of `commands.command()`: the guard filters what would run. */
const COMMAND_MATCHERS = ADMIN_COMMANDS.map((name) => ({
  name,
  matches: Context.has.command(name),
}));

/** The command of the registry a message starts with: `/grant`, or `/grant@<this bot>`. */
const adminCommandOf = (ctx: BotContext): AdminCommandName | undefined =>
  COMMAND_MATCHERS.find(({ matches }) => matches(ctx))?.name;

export type AdminGuard = {
  /** An id of `ADMIN_TELEGRAM_IDS` (§12): an empty list makes no admin. */
  isAdmin: (telegramId: number | bigint | undefined) => boolean;
  /** The commands of the registry, registered here, run for an admin only. */
  commands: Composer<BotContext>;
  /**
   * Mounted after the gate, before the input router and the callback router (V1-38): a command
   * of the registry, an `adm:*` click or the message an admin input waits for, from anyone else,
   * meets what an unknown command meets, silence (§15) — the click is answered empty by
   * `ensureAnswered`. Checked every time, so an id removed from the list stops at once.
   */
  middleware: () => MiddlewareFn<BotContext>;
};

export function createAdminGuard(adminIds: readonly number[]): AdminGuard {
  const admins = new Set(adminIds.map((id) => BigInt(id)));
  const isAdmin = (telegramId: number | bigint | undefined): boolean =>
    telegramId !== undefined && admins.has(BigInt(telegramId));
  const commands = new Composer<BotContext>();

  return {
    isAdmin,
    commands,
    middleware: () => {
      const run = commands.middleware();
      return async (ctx, next) => {
        const command = adminCommandOf(ctx);
        const data = ctx.callbackQuery?.data;
        // The domain as the router reads it: what it would route to `adm`.
        const click = data !== undefined && decodeCallback(data)?.domain === "adm";
        const input = isAdminInput(ctx);
        if (command === undefined && !click && !input) return next();
        if (!isAdmin(ctx.from?.id)) {
          // The name of the command only: its arguments name another user.
          const what = command ?? (click ? "callback" : "input");
          log.info({ telegramId: ctx.from?.id, command: what }, "admin.denied");
          return;
        }
        // A command runs here; an admin click or input goes on to its router.
        await run(ctx, next);
      };
    },
  };
}
