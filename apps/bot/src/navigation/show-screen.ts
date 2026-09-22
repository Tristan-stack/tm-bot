import { en } from "@launchbot/shared";
import type { Screen } from "@launchbot/shared";
import type { BotContext, PendingInput } from "../context.js";
import { notify } from "./notify.js";
import { isNotModified, isUneditable } from "./telegram-errors.js";

/**
 * - `sent`: a new screen message (a /start, or an answer to a user input).
 * - `edited`: the existing screen was edited in place (§4.4).
 * - `sent_new`: the edit was impossible, a new message replaced it.
 * - `not_modified`: Telegram refused an identical edit; the caller decides what to say (§4.4).
 */
export type ShowStatus = "sent" | "edited" | "sent_new" | "not_modified";
export type ShowResult = { status: ShowStatus; messageId: number };
/**
 * - `auto`: a click edits the message that carries the button, anything else sends.
 * - `new`: always a new message (/start, §4.3).
 * - `edit`: edits the screen message of the session even outside a click, after the message
 *   of the user was deleted (an input answered in place, V1-11); sends when there is none.
 */
export type ShowMode = "auto" | "new" | "edit";

/**
 * Single-message navigation (§4.3, §4.4): the bot edits one screen message instead of sending
 * a new one on every click. `screen` comes from `renderScreen` (HTML, link previews disabled).
 */
export async function showScreen(
  ctx: BotContext,
  screen: Screen,
  options: { mode?: ShowMode; input?: PendingInput } = {},
): Promise<ShowResult> {
  const { mode = "auto", input } = options;
  // The input a screen waits for lives exactly as long as that screen is the live one: every
  // other screen shown clears it, whatever click or command led there.
  if (input === undefined) delete ctx.session.pendingInput;
  else ctx.session.pendingInput = input;

  // /start always sends a new message (§4.3).
  if (mode === "new") return send(ctx, screen);

  const messageId =
    ctx.callbackQuery?.message?.message_id ??
    (mode === "edit" ? ctx.session.screenMessageId : undefined);
  // A user input gets a new screen, so it stays at the bottom of the chat, and the previous
  // keyboard is unarmed.
  if (messageId === undefined || ctx.chatId === undefined) {
    await dropOldKeyboard(ctx);
    return send(ctx, screen);
  }

  try {
    const { text, ...rest } = screen;
    await ctx.api.editMessageText(ctx.chatId, messageId, text, rest);
  } catch (error) {
    // Identical content: no exception, the caller answers "Already up to date" if it wants to.
    if (isNotModified(error)) return { status: "not_modified", messageId };
    if (!isUneditable(error)) throw error;
    return { ...(await send(ctx, screen)), status: "sent_new" };
  }
  ctx.session.screenMessageId = messageId;
  return { status: "edited", messageId };
}

async function send(ctx: BotContext, screen: Screen): Promise<ShowResult> {
  const { text, ...rest } = screen;
  const message = await ctx.reply(text, rest);
  ctx.session.screenMessageId = message.message_id;
  return { status: "sent", messageId: message.message_id };
}

/** The previous screen keeps its text but loses its buttons, so only the new screen is live. */
async function dropOldKeyboard(ctx: BotContext): Promise<void> {
  const previous = ctx.session.screenMessageId;
  if (previous === undefined || ctx.chatId === undefined) return;
  try {
    await ctx.api.editMessageReplyMarkup(ctx.chatId, previous);
  } catch {
    // The old screen may be gone or already without a keyboard: nothing to do about it.
  }
}

/** The two halves of a blocked click: a pair of en.ts, or `tooManyActions`. */
export type Block = { alert: string; flag: string };

/**
 * A blocked click (§4.5): the alert is the quick feedback, and the screen is rewritten with
 * the flag that says what is missing. An identical screen means the flag is already there.
 */
export async function blockWithFlag(
  ctx: BotContext,
  block: Block,
  render: (flag: string) => Screen,
  options: { mode?: ShowMode } = {},
): Promise<void> {
  await notify(ctx, block.alert, { alert: true });
  await showScreen(ctx, render(block.flag), options);
}

/**
 * After a Refresh (§4.4): "Updated" shows minutes, so a Refresh with nothing new in the same
 * minute is the same screen, which Telegram refuses to edit. The user hears it as a toast.
 */
export async function notifyIfUnchanged(ctx: BotContext, result: ShowResult | null): Promise<void> {
  if (result?.status === "not_modified") await notify(ctx, en.common.alreadyUpToDate);
}
