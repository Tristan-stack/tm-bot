import type { Screen } from "@launchbot/shared";
import type { BotContext } from "../context.js";
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
/** `new`: always a new message (/start, §4.3). `auto`: a click edits, anything else sends. */
export type ShowMode = "auto" | "new";

/**
 * Single-message navigation (§4.3, §4.4): the bot edits one screen message instead of sending
 * a new one on every click. `screen` comes from `renderScreen` (HTML, link previews disabled).
 */
export async function showScreen(
  ctx: BotContext,
  screen: Screen,
  options: { mode?: ShowMode } = {},
): Promise<ShowResult> {
  // /start always sends a new message (§4.3).
  if (options.mode === "new") return send(ctx, screen);

  // A click edits the message that carries the button. Anything else (a user input) sends a
  // new screen, so it stays at the bottom of the chat, and unarms the previous keyboard.
  const messageId = ctx.callbackQuery?.message?.message_id;
  if (messageId === undefined) {
    await dropOldKeyboard(ctx);
    return send(ctx, screen);
  }

  try {
    const { text, ...rest } = screen;
    await ctx.editMessageText(text, rest);
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
): Promise<void> {
  await notify(ctx, block.alert, { alert: true });
  await showScreen(ctx, render(block.flag));
}
