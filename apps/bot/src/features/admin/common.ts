import type { User } from "@launchbot/db";
import {
  cbBtn,
  en,
  encodeCallback,
  escapeHtml,
  NAV_HOME,
  parseUserRef,
  renderScreen,
} from "@launchbot/shared";
import type { Button, Offer, Screen, Ui, UserRef } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { z } from "zod";
import type { BotContext } from "../../context.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { ShowResult } from "../../navigation/show-screen.js";
import { telegramErrorFields } from "../../navigation/telegram-errors.js";
import type { AdminCommandName } from "./guard.js";

const log = createLogger("bot:admin");

/**
 * Callback data of the admin commands (V1-38): `adm:<command>:<action>[:<arg>]`, filtered by the
 * guard. A nonce or a Telegram id, never anything of the account.
 */
export const ADMIN_CB = {
  grantConfirm: (nonce: string) => encodeCallback("adm", "grant", "ok", nonce),
  grantCancel: (nonce: string) => encodeCallback("adm", "grant", "no", nonce),
  reveal: (nonce: string) => encodeCallback("adm", "ga", "rev", nonce),
  revealCancel: (nonce: string) => encodeCallback("adm", "ga", "no", nonce),
  purgeConfirm: (telegramId: bigint) => encodeCallback("adm", "prg", "ok", telegramId),
  purgeCancel: encodeCallback("adm", "prg", "no"),
} as const;

/** `[ 🏠 Menu ]`: what the results of /purge end on (V1-44). */
export const MENU_ROW: Button[] = [cbBtn(en.btn.menu, NAV_HOME)];

/** The arguments of a command as words: what grammY leaves after it (`ctx.match`). */
export const argWords = (text: string): string[] => text.split(/\s+/).filter((word) => word !== "");

/** An account named by an admin (V1-40): what was typed, for « Searched: », and what it reads. */
export const userArg = z.string().transform((query, ctx) => {
  const ref = parseUserRef(query);
  if (ref === null) {
    ctx.addIssue({ code: "custom", message: "Not a Telegram id or a support code" });
    return z.NEVER;
  }
  return { query, ref };
});

/**
 * `/whois`, `/getall`, `/purge`: one account, nothing else. The schemas of the commands are
 * tuples of words: a word missing or in excess is a syntax error.
 */
export const oneUserArgs = z.tuple([userArg]);

/** The title of a command of the registry, as the header of its screens. */
export const adminHeader = (ui: Ui, name: AdminCommandName): string =>
  ui.screenHeader(en.admin.commands[name].title);

/** `Premium · 1 month`: an offer, an invoice or a period of a plan. */
export const offerLabel = (offer: Pick<Offer, "plan" | "duration">): string =>
  `${en.plans[offer.plan]} · ${en.durations[offer.duration]}`;

/**
 * A message to the account an admin acted on (V1-42, V1-44): `false` when Telegram refused it
 * (blocked, the chat gone). Never `payload`: it holds the text sent.
 */
export async function tellUser(
  ctx: BotContext,
  user: { id: string; telegramId: bigint },
  message: Screen | string,
  event: string,
): Promise<boolean> {
  const { text, ...other } = typeof message === "string" ? { text: message } : message;
  try {
    await ctx.api.sendMessage(user.telegramId.toString(), text, other);
    return true;
  } catch (error) {
    log.info({ userId: user.id, ...telegramErrorFields(error) }, event);
    return false;
  }
}

/** The syntax reminder of a command (V1-38): one format, the usage and the example escaped. */
export function renderAdminUsageError(ui: Ui, name: AdminCommandName): Screen {
  const { usage, example } = en.admin.commands[name];
  return renderScreen({
    header: adminHeader(ui, name),
    info: [
      en.admin.common.invalid,
      en.admin.common.usage(escapeHtml(usage)),
      en.admin.common.example(escapeHtml(example)),
    ],
    keyboard: [],
  });
}

/** « ❌ User not found. » and what was searched (V1-38); `lines`: what the command adds. */
export function renderAdminUserNotFound(
  ui: Ui,
  name: AdminCommandName,
  query: string,
  options: { lines?: string[]; keyboard?: Button[][] } = {},
): Screen {
  const { lines = [], keyboard = [] } = options;
  const notFound = [en.admin.common.notFound, en.admin.common.searched(escapeHtml(query))];
  return renderScreen({
    header: adminHeader(ui, name),
    info: [notFound.join("\n"), ...(lines.length === 0 ? [] : [lines.join("\n")])].join("\n\n"),
    keyboard,
  });
}

/** A result of one line under the title of its command: canceled, expired, failed. */
export function renderAdminNotice(
  ui: Ui,
  name: AdminCommandName,
  text: string,
  keyboard: Button[][] = [],
): Screen {
  return renderScreen({ header: adminHeader(ui, name), description: text, keyboard });
}

/** A screen as long as Telegram allows, already split: the keyboard goes on its last part. */
export const screenOf = (text: string, keyboard: Button[][] = []): Screen => ({
  text,
  reply_markup: { inline_keyboard: keyboard },
  parse_mode: "HTML",
  link_preview_options: { is_disabled: true },
});

/** What the handlers of the admin commands share, bound to the process (V1-38). */
export type AdminKit = {
  ui: Ui;
  /** A new message in answer to a command: the admin's screen from then on. */
  reply: (ctx: BotContext, screen: Screen) => Promise<ShowResult>;
  /** The parts of a long message in order, the keyboard on the last one (V1-43). */
  replyParts: (ctx: BotContext, parts: string[], keyboard?: Button[][]) => Promise<void>;
  replyUsageError: (ctx: BotContext, name: AdminCommandName) => Promise<ShowResult>;
  /**
   * The arguments of a command, or `null` once the syntax reminder is sent (`parseAdminArgs` of
   * V1-38). The schema reads the words after the command.
   */
  parseArgs: <T>(
    ctx: BotContext,
    name: AdminCommandName,
    schema: z.ZodType<T>,
  ) => Promise<T | null>;
  /**
   * `resolveUserRef` of V1-40: the account of a ref `userArg` already parsed. The letter of a
   * code is only what it claimed: the commands read the plan again. An account purged (V1-44) or
   * deleted for inactivity (V1-45) is `null`, like an id never seen.
   */
  resolveUserRef: (ref: UserRef) => Promise<User | null>;
  /** « ❌ User not found. » and what was typed, as a new message. */
  replyNotFound: (ctx: BotContext, name: AdminCommandName, query: string) => Promise<ShowResult>;
};

export function createAdminKit(deps: {
  ui: Ui;
  findUser: (telegramId: bigint) => Promise<User | null>;
}): AdminKit {
  const { ui, findUser } = deps;
  const reply = (ctx: BotContext, screen: Screen) => showScreen(ctx, screen, { mode: "new" });
  const replyUsageError = (ctx: BotContext, name: AdminCommandName) =>
    reply(ctx, renderAdminUsageError(ui, name));

  return {
    ui,
    reply,
    replyUsageError,

    async replyParts(ctx, parts, keyboard = []) {
      const last = parts.length - 1;
      for (const [index, part] of parts.entries()) {
        if (index === last) {
          await reply(ctx, screenOf(part, keyboard));
        } else {
          const { text, ...rest } = screenOf(part);
          await ctx.reply(text, rest);
        }
      }
    },

    async parseArgs(ctx, name, schema) {
      const parsed = schema.safeParse(argWords(typeof ctx.match === "string" ? ctx.match : ""));
      if (parsed.success) return parsed.data;
      await replyUsageError(ctx, name);
      return null;
    },

    resolveUserRef: (ref) => findUser(ref.telegramId),

    replyNotFound: (ctx, name, query) => reply(ctx, renderAdminUserNotFound(ui, name, query)),
  };
}
