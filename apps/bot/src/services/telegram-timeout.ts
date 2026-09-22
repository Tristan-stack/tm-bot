import { SECOND_MS } from "@launchbot/shared";
import type { Api } from "grammy";

/** Proposal. */
const TELEGRAM_READ_TIMEOUT_MS = 5 * SECOND_MS;

type GrammySignal = NonNullable<Parameters<Api["getChatMemberCount"]>[1]>;

/**
 * The signal of a Telegram read that a screen waits for. The bot handles one update at a time
 * and grammY waits 500 s by default: such a read gives up early, and the screen falls back.
 */
export const readTimeout = (): GrammySignal =>
  // grammY types its signals with the `abort-controller` shim; at run time it takes Node's.
  AbortSignal.timeout(TELEGRAM_READ_TIMEOUT_MS) as unknown as GrammySignal;
