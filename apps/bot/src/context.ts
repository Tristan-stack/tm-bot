import type { PayInFlight, User } from "@launchbot/db";
import { ACTIVATION_KINDS, OFFER_CODES, TOKEN_FIELDS } from "@launchbot/shared";
import type { ComputedActivation, ImportFormat, OfferCode, TokenField } from "@launchbot/shared";
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
  | { kind: "withdraw_amount" }
  /** A field of the Token screen (V1-16); `since` lets a forgotten input expire (proposal). */
  | { kind: "token_field"; flow: TokenFlow; field: TokenInputField; since: number }
  /** The Custom bundle of a simulation (V1-22). */
  | { kind: "sim_amount" }
  /** The Custom bundle of a launch (V1-36): its wallet is in `launch`. */
  | { kind: "launch_amount" };

/** The two flows the Token step serves (§5): step 1 of a simulation, step 3 of a launch. */
export const TOKEN_FLOWS = ["SIMULATION", "LAUNCH"] as const;
export type TokenFlow = (typeof TOKEN_FLOWS)[number];
/** The six text fields of V1-15 and the image, which is a photo, not a text. */
export type TokenInputField = TokenField | "image";
const TOKEN_INPUT_FIELDS: readonly string[] = [...TOKEN_FIELDS, "image"];

/**
 * What the Token step keeps per flow (V1-16): the draft being edited, and whether Continue
 * was refused, so the "Missing" flag stays until the fields are there. Kept across screens:
 * the draft of a simulation is found again from the menu.
 */
export type TokenStepState = { draftId?: string; showMissing?: boolean };

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

/**
 * The bundle chosen in Simulate a Launch (V1-22, decision of 25/09/2026; the dev buy is a
 * fixed 1 SOL): kept across screens, so Back from the recap shows it again. The draft is in
 * `tokenStep.SIMULATION`; the Simulation is found again from both (reuse rule of V1-22), so
 * its id is not kept here.
 */
export type SimFlowState = { bundleSol?: number };

/**
 * Launch Coin (V1-35 to V1-37): ids and amounts only, never a balance, never a key. The wallet
 * is chosen again at each launch; the draft is in `tokenStep.LAUNCH`. Amounts are lamports as
 * decimal strings: JSON has no bigint.
 */
export type LaunchFlowState = {
  walletId?: string;
  /** The bundle chosen at step 2; the dev buy is a fixed 1 SOL (decision of 25/09/2026). */
  bundleLamports?: string;
  /** A bundle the wallet could not cover: the note of step 2 and its Refresh. */
  blockedLamports?: string;
};

/**
 * Pay from my wallet (V1-31): ids and the amount the confirmation showed, read again from the
 * database at every click; never a balance, never a key. Not tied to the screens like
 * `withdraw`: a send of unknown outcome must be remembered on the invoice screen it returns to.
 */
export type PayState = {
  paymentId: string;
  /** The confirmation shown last: its wallet, the rest it showed, the token of its Confirm. */
  confirm?: {
    walletId: string;
    /** Lamports as a decimal string: JSON has no bigint. */
    amount: string;
    /** Spent before the send: an older Confirm, or a second click, is a stale button. */
    token?: string;
  };
  /** A send whose outcome was unknown (proposal): the next Confirm reads its signature first. */
  sent?: PayInFlight;
};

/**
 * The confirmation screen of a /grant (V1-42): what it showed, for its one Confirm. Replaced by
 * every /grant; the nonce is in the buttons, the guard of a second click is in the database.
 */
export type AdminGrantState = {
  nonce: string;
  targetUserId: string;
  /** A decimal string: JSON has no bigint. */
  targetTelegramId: string;
  offerCode: OfferCode;
  kind: ComputedActivation["kind"];
  /** The end an extension builds on, in ms; `null` without an active plan. */
  currentExpiresAt: number | null;
  createdAt: number;
};

/**
 * The Reveal keys of a /getall (V1-43, decision of 16/09/2026): a nonce and whose keys, never a
 * key. Replaced by every /getall, spent by its first click.
 */
export type GetAllRevealState = {
  nonce: string;
  targetUserId: string;
  targetTelegramId: string;
  createdAt: number;
};

export type SessionData = {
  v: typeof SESSION_VERSION;
  /** The one screen message the navigation edits (§4.4). */
  screenMessageId?: number;
  pendingInput?: PendingInput;
  withdraw?: WithdrawState;
  tokenStep?: Partial<Record<TokenFlow, TokenStepState>>;
  sim?: SimFlowState;
  pay?: PayState;
  launch?: LaunchFlowState;
  adminGrant?: AdminGrantState;
  getallReveal?: GetAllRevealState;
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
    case "sim_amount":
    case "launch_amount":
      return true;
    case "wallet_import":
      return (
        (input.format === "KEY" || input.format === "SEED") && typeof input.expiresAt === "number"
      );
    case "token_field":
      return (
        isTokenFlow(input.flow) &&
        TOKEN_INPUT_FIELDS.includes(input.field) &&
        typeof input.since === "number"
      );
    default:
      return false;
  }
};

export const isTokenFlow = (value: unknown): value is TokenFlow =>
  (TOKEN_FLOWS as readonly unknown[]).includes(value);

const isTokenStep = (value: unknown): value is Partial<Record<TokenFlow, TokenStepState>> => {
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value as Record<string, unknown>).every(([flow, state]) => {
    if (!isTokenFlow(flow) || typeof state !== "object" || state === null) return false;
    const { draftId, showMissing } = state as TokenStepState;
    return isOptionalString(draftId) && (showMissing === undefined || showMissing === true);
  });
};

const isSimFlow = (value: unknown): value is SimFlowState => {
  if (typeof value !== "object" || value === null) return false;
  const { bundleSol } = value as SimFlowState;
  return bundleSol === undefined || (typeof bundleSol === "number" && Number.isFinite(bundleSol));
};

/** A bigint as JSON holds it: lamports, a Telegram id. */
const isDigits = (value: unknown): boolean => typeof value === "string" && /^\d+$/.test(value);

const isOptionalLamports = (value: unknown): boolean => value === undefined || isDigits(value);

const isLaunchState = (value: unknown): value is LaunchFlowState => {
  if (typeof value !== "object" || value === null) return false;
  const { walletId, bundleLamports, blockedLamports } = value as LaunchFlowState;
  return (
    isOptionalString(walletId) &&
    isOptionalLamports(bundleLamports) &&
    isOptionalLamports(blockedLamports)
  );
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

const isPayConfirm = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const { walletId, amount, token } = value as Record<string, unknown>;
  return typeof walletId === "string" && typeof amount === "string" && isOptionalString(token);
};

const isPaySent = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const { signature, sentAt } = value as Record<string, unknown>;
  return typeof signature === "string" && typeof sentAt === "number";
};

const isPayState = (value: unknown): value is PayState => {
  if (typeof value !== "object" || value === null) return false;
  const state = value as PayState;
  return (
    typeof state.paymentId === "string" &&
    (state.confirm === undefined || isPayConfirm(state.confirm)) &&
    (state.sent === undefined || isPaySent(state.sent))
  );
};

const GRANT_KINDS: readonly unknown[] = [...ACTIVATION_KINDS, "REFUSED"];

const isAdminGrant = (value: unknown): value is AdminGrantState => {
  if (typeof value !== "object" || value === null) return false;
  const state = value as AdminGrantState;
  return (
    typeof state.nonce === "string" &&
    typeof state.targetUserId === "string" &&
    isDigits(state.targetTelegramId) &&
    (OFFER_CODES as readonly unknown[]).includes(state.offerCode) &&
    GRANT_KINDS.includes(state.kind) &&
    (state.currentExpiresAt === null || typeof state.currentExpiresAt === "number") &&
    typeof state.createdAt === "number"
  );
};

const isGetAllReveal = (value: unknown): value is GetAllRevealState => {
  if (typeof value !== "object" || value === null) return false;
  const state = value as GetAllRevealState;
  return (
    typeof state.nonce === "string" &&
    typeof state.targetUserId === "string" &&
    isDigits(state.targetTelegramId) &&
    typeof state.createdAt === "number"
  );
};

/** True for data this version can use; anything else is replaced by a fresh session. */
export function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Partial<SessionData>;
  if (data.v !== SESSION_VERSION) return false;
  if (data.screenMessageId !== undefined && typeof data.screenMessageId !== "number") return false;
  if (data.withdraw !== undefined && !isWithdrawState(data.withdraw)) return false;
  if (data.pay !== undefined && !isPayState(data.pay)) return false;
  if (data.tokenStep !== undefined && !isTokenStep(data.tokenStep)) return false;
  if (data.sim !== undefined && !isSimFlow(data.sim)) return false;
  if (data.launch !== undefined && !isLaunchState(data.launch)) return false;
  if (data.adminGrant !== undefined && !isAdminGrant(data.adminGrant)) return false;
  if (data.getallReveal !== undefined && !isGetAllReveal(data.getallReveal)) return false;
  return data.pendingInput === undefined || isPendingInput(data.pendingInput);
}

export type BotContext = Context &
  SessionFlavor<SessionData> &
  ConversationFlavor<Context> & {
    /** Set by the userActivity middleware, before any handler runs. */
    user: User;
  };
