import { isValidSolanaAddress, parseSolToLamports } from "@launchbot/shared";
import type { ImportedSuccessCard } from "@launchbot/shared";

const TICKER = /\$([A-Za-z][A-Za-z0-9]{0,15})\s*\|\s*[+-]?\d+%/;
const MINT = /CA:\s*([1-9A-HJ-NP-Za-km-z]{32,44})/;
const INVESTED = /Invested:\s*(\d+(?:\.\d{1,9})?)\s*SOL(?:\s*\(\$(\d+(?:\.\d+)?)(K)?\))?/i;
const SELL = /Sell:\s*(\d+(?:\.\d{1,9})?)\s*SOL/i;

function usdAmount(amount: string, kilo: string | undefined): number | null {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return kilo === "K" ? value * 1000 : value;
}

/**
 * A RugPilot profit card. Anything else, including a card with no mint or no amounts, is skipped.
 * The wallet line is ignored.
 */
export function parseRugpilotCard(text: string): ImportedSuccessCard | undefined {
  const ticker = TICKER.exec(text);
  const mint = MINT.exec(text);
  const invested = INVESTED.exec(text);
  const sell = SELL.exec(text);
  const symbol = ticker?.[1];
  const address = mint?.[1];
  const investedSol = invested?.[1];
  const soldSol = sell?.[1];
  if (
    symbol === undefined ||
    address === undefined ||
    investedSol === undefined ||
    soldSol === undefined ||
    !isValidSolanaAddress(address)
  ) {
    return undefined;
  }
  const investedLamports = parseSolToLamports(investedSol);
  const soldLamports = parseSolToLamports(soldSol);
  if (investedLamports === null || soldLamports === null) return undefined;
  const usd = invested?.[2] === undefined ? null : usdAmount(invested[2], invested[3]);
  const sol = Number(investedSol);
  const solUsd = usd === null || !Number.isFinite(sol) || sol <= 0 ? null : usd / sol;
  return { symbol, mint: address, investedLamports, soldLamports, solUsd };
}

export type PostedState = Map<number, number>;

/** `undefined` when the file is not JSON of `{ posted: { "<id>": messageId } }`. */
export function parsePostedState(raw: string): PostedState | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || !("posted" in value)) return undefined;
  const posted = value.posted;
  if (typeof posted !== "object" || posted === null) return undefined;
  const state: PostedState = new Map();
  for (const [key, messageId] of Object.entries(posted)) {
    if (!/^\d+$/.test(key) || typeof messageId !== "number" || !Number.isSafeInteger(messageId)) {
      return undefined;
    }
    state.set(Number(key), messageId);
  }
  return state;
}

export function serializePostedState(posted: ReadonlyMap<number, number>): string {
  const entries = [...posted.entries()].sort(([left], [right]) => left - right);
  return `${JSON.stringify({ posted: Object.fromEntries(entries) }, null, 2)}\n`;
}
