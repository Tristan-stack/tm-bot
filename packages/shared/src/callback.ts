import { TG } from "./constants.js";
import { utf8ByteLength } from "./format/text.js";

/**
 * Callback data (§4.4): `<domain>:<action>[:<arg>…]`, 64 bytes max.
 * Arguments are ids and enum codes only: never a key, a seed phrase or a user input (§9.6).
 */
export const CALLBACK_DOMAINS = [
  "nav", // nav:home: Back / Menu to the home screen
  "home", // home refresh
  "acc", // first access: the channel
  "wal", // wallets, import, withdrawal
  "tok", // Token screen
  "sim", // simulation
  "lc", // Launch Coin flow (V1)
  "lch", // My launches (V2-05)
  "sub", // plans, invoice, pay from a wallet
  "sup", // support
  "adm", // admin
] as const;

export type CallbackDomain = (typeof CALLBACK_DOMAINS)[number];
export type CallbackArg = string | number | bigint;

declare const callbackDataBrand: unique symbol;
/**
 * Callback data produced by `encodeCallback`, the only way to get one. Buttons accept nothing
 * else, so a hand-typed string (wrong domain, typo, too long) does not compile instead of
 * showing up in production as a button that does nothing.
 */
export type CallbackData = string & { readonly [callbackDataBrand]: true };
export type DecodedCallback = { domain: CallbackDomain; action: string; args: string[] };

export class CallbackDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallbackDataError";
  }
}

const SEPARATOR = ":";
const PART = /^[A-Za-z0-9_-]+$/;

const isDomain = (value: string): value is CallbackDomain =>
  (CALLBACK_DOMAINS as readonly string[]).includes(value);

/** Telegram accepts 1 to 64 bytes of callback data. */
export function isCallbackDataSize(data: string): boolean {
  const bytes = utf8ByteLength(data);
  return bytes >= 1 && bytes <= TG.CALLBACK_DATA_MAX_BYTES;
}

export function encodeCallback(
  domain: CallbackDomain,
  action: string,
  ...args: CallbackArg[]
): CallbackData {
  if (!isDomain(domain)) throw new CallbackDataError("Unknown callback domain");
  const parts = [action, ...args.map(String)];
  // The faulty part is not echoed: an argument must never be a secret, but it could be by mistake.
  if (!parts.every((part) => PART.test(part))) {
    throw new CallbackDataError(`Callback parts of "${domain}" must match ${PART.source}`);
  }
  const data = [domain, ...parts].join(SEPARATOR);
  if (!isCallbackDataSize(data)) {
    throw new CallbackDataError(`Callback data must be 1 to ${TG.CALLBACK_DATA_MAX_BYTES} bytes`);
  }
  return data as CallbackData;
}

/** `null` for anything this codec could not have produced (handled by the router, V1-04). */
export function decodeCallback(data: string): DecodedCallback | null {
  if (!isCallbackDataSize(data)) return null;
  const [domain, action, ...args] = data.split(SEPARATOR);
  if (domain === undefined || !isDomain(domain) || action === undefined) return null;
  if (![action, ...args].every((part) => PART.test(part))) return null;
  return { domain, action, args };
}

/** Back and Menu to the home screen share this callback (V1-08). */
export const NAV_HOME = encodeCallback("nav", "home");

/** The Launch Coin entry: the main menu (V1-08) and « Payment received » (V1-30, V1-32). */
export const LAUNCH_COIN = encodeCallback("lc", "open");

/**
 * The offers screen (V1-29): the Subscribe button of the menu, and Renew on the end-of-plan
 * reminder the worker sends (V1-34).
 */
export const SUB_OPEN = encodeCallback("sub", "open");
