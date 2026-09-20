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
