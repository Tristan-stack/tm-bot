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
  | { kind: "wallet_import"; format: ImportFormat; expiresAt: number }
  /** The address, then the custom amount, of a withdrawal (V1-14): its wallet is in `withdraw`. */
  | { kind: "withdraw_address" }
  | { kind: "withdraw_amount" };

/** `all`: opened from the Delete blocking (§9.3), Max chosen, the amount step skipped. */
export type WithdrawMode = "normal" | "all";

/**
 * The withdrawal being built (V1-14, §9.5): never a secret, never a balance. It lives exactly
 * as long as the screens of the flow: `showScreen` keeps it for them and drops it for any
 * other screen, like `pendingInput`. Amounts are strings: JSON has no bigint.
 */
export type WithdrawState = {
  walletId: string;
  mode: WithdrawMode;
  toAddress?: string;
  /** Lamports as a decimal string, or `max`. */
  amount?: string;
  /** The Confirm button of the screen being shown: an older one is a stale button. */
  confirmToken?: string;
};

export type SessionData = {
  v: typeof SESSION_VERSION;
  /** The one screen message the navigation edits (§4.4). */
  screenMessageId?: number;
  pendingInput?: PendingInput;
  withdraw?: WithdrawState;
};

export const initialSession = (): SessionData => ({ v: SESSION_VERSION });

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

const isPendingInput = (value: unknown): value is PendingInput => {
  if (typeof value !== "object" || value === null) return false;
  const input = value as PendingInput;
  switch (input.kind) {
    case "wallet_rename":
      return typeof input.walletId === "string";
    case "withdraw_address":
    case "withdraw_amount":
      return true;
    case "wallet_import":
      return (
        (input.format === "KEY" || input.format === "SEED") && typeof input.expiresAt === "number"
      );
    default:
      return false;
  }
};

const isWithdrawState = (value: unknown): value is WithdrawState => {
  if (typeof value !== "object" || value === null) return false;
  const state = value as WithdrawState;
  return (
    typeof state.walletId === "string" &&
    (state.mode === "normal" || state.mode === "all") &&
    isOptionalString(state.toAddress) &&
    isOptionalString(state.amount) &&
    isOptionalString(state.confirmToken)
  );
};

/** True for data this version can use; anything else is replaced by a fresh session. */
export function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Partial<SessionData>;
  if (data.v !== SESSION_VERSION) return false;
  if (data.screenMessageId !== undefined && typeof data.screenMessageId !== "number") return false;
  if (data.withdraw !== undefined && !isWithdrawState(data.withdraw)) return false;
  return data.pendingInput === undefined || isPendingInput(data.pendingInput);
}

export type BotContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context> & {
    /** Set by the userActivity middleware, before any handler runs. */
    user: User;
  };
