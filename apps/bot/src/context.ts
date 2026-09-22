import type { User } from "@launchbot/db";
import type { ImportFormat } from "@launchbot/shared";
import type { ConversationFlavor } from "@grammyjs/conversations";
import type { Context, SessionFlavor } from "grammy";

/**
 * Session (D16). Each ticket adds its own optional fields. Never a secret: the rows live in
 * PostgreSQL in plain text. `v` lets an old shape be dropped instead of crashing, so sessions
 * survive a deployment.
 */
export const SESSION_VERSION = 1;

/**
 * The input the next text message of the user answers (V1-11). Persisted with the session, so
 * it survives a restart; every other screen shown drops it (`showScreen`).
 *
 * `wallet_import` never holds the secret, only the moment its window closes (§9.4): a phrase
 * sent too late is still deleted, and the screen says the import expired.
 */
export type PendingInput =
  | { kind: "wallet_rename"; walletId: string }
  | { kind: "wallet_import"; format: ImportFormat; expiresAt: number };

export type SessionData = {
  v: typeof SESSION_VERSION;
  /** The one screen message the navigation edits (§4.4). */
  screenMessageId?: number;
  pendingInput?: PendingInput;
};

export const initialSession = (): SessionData => ({ v: SESSION_VERSION });

const isPendingInput = (value: unknown): value is PendingInput => {
  if (typeof value !== "object" || value === null) return false;
  const input = value as PendingInput;
  if (input.kind === "wallet_rename") return typeof input.walletId === "string";
  return (
    input.kind === "wallet_import" &&
    (input.format === "KEY" || input.format === "SEED") &&
    typeof input.expiresAt === "number"
  );
};

/** True for data this version can use; anything else is replaced by a fresh session. */
export function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Partial<SessionData>;
  if (data.v !== SESSION_VERSION) return false;
  if (data.screenMessageId !== undefined && typeof data.screenMessageId !== "number") return false;
  return data.pendingInput === undefined || isPendingInput(data.pendingInput);
}

export type BotContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context> & {
    /** Set by the userActivity middleware, before any handler runs. */
    user: User;
  };
