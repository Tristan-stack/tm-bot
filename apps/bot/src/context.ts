import type { User } from "@launchbot/db";
import type { ConversationFlavor } from "@grammyjs/conversations";
import type { Context, SessionFlavor } from "grammy";

/**
 * Session (D16). Each ticket adds its own optional fields. Never a secret: the rows live in
 * PostgreSQL in plain text. `v` lets an old shape be dropped instead of crashing, so sessions
 * survive a deployment.
 */
export const SESSION_VERSION = 1;

export type SessionData = {
  v: typeof SESSION_VERSION;
  /** The one screen message the navigation edits (§4.4). */
  screenMessageId?: number;
};

export const initialSession = (): SessionData => ({ v: SESSION_VERSION });

/** True for data this version can use; anything else is replaced by a fresh session. */
export function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Partial<SessionData>;
  if (data.v !== SESSION_VERSION) return false;
  return data.screenMessageId === undefined || typeof data.screenMessageId === "number";
}

export type BotContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context> & {
    /** Set by the userActivity middleware, before any handler runs. */
    user: User;
  };
