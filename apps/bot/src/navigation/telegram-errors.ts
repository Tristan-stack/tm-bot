import { GrammyError } from "grammy";

/**
 * Telegram reports these cases as a plain 400: the description is the only signal there is.
 * The patterns live here so that a wording change is fixed in one place.
 */
const isBadRequest = (error: unknown, pattern: RegExp): boolean =>
  error instanceof GrammyError && error.error_code === 400 && pattern.test(error.description);

/** The edit would change nothing (§4.4). */
export const isNotModified = (error: unknown): boolean =>
  isBadRequest(error, /message is not modified/i);

/** The screen message is gone, or is not a text message the bot can edit. */
export const isUneditable = (error: unknown): boolean =>
  isBadRequest(
    error,
    /message to edit not found|message can't be edited|there is no text in the message to edit|MESSAGE_ID_INVALID/i,
  );

/** A callback query older than its validity window can no longer be answered. */
export const isQueryTooOld = (error: unknown): boolean => isBadRequest(error, /query is too old/i);

/** The message to delete is already gone: nothing is left to do. */
export const isAlreadyDeleted = (error: unknown): boolean =>
  isBadRequest(error, /message to delete not found/i);

/**
 * The message cannot be deleted at all: already gone, or older than the 48 h a bot is given in a
 * private chat (V1-12). Retrying such a refusal only wastes a call.
 */
export const isUndeletable = (error: unknown): boolean =>
  isBadRequest(error, /message to delete not found|message can't be deleted|MESSAGE_ID_INVALID/i);

/**
 * Why a post in a channel failed (V1-38, reusable by the Success post of V1-39): the bot cannot
 * post there (removed, no right to post, the chat gone), Telegram rate-limits it, or anything else.
 */
export type SendFailure = "cant_post" | "rate_limited" | "error";

const CANT_POST =
  /chat not found|not enough rights|need administrator rights|have no rights|CHAT_WRITE_FORBIDDEN|CHAT_ADMIN_REQUIRED/i;

export function sendFailureOf(error: unknown): SendFailure {
  if (!(error instanceof GrammyError)) return "error";
  if (error.error_code === 429) return "rate_limited";
  // 403: the bot was removed from the channel, or is not a member of it.
  if (error.error_code === 403 || isBadRequest(error, CANT_POST)) return "cant_post";
  return "error";
}

/** The wait Telegram asks for after a 429, in ms; `undefined` for any other failure. */
export function retryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof GrammyError) || error.error_code !== 429) return undefined;
  const seconds = error.parameters.retry_after;
  return seconds === undefined ? undefined : seconds * 1000;
}

/**
 * What a log says of a failed call: Telegram's code and description, never `payload`, which
 * holds the text sent (a key, a user input).
 */
export const telegramErrorFields = (
  error: unknown,
): { errorCode: number; description: string } | { err: unknown } =>
  error instanceof GrammyError
    ? { errorCode: error.error_code, description: error.description }
    : { err: error };
