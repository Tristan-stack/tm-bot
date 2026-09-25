import { randomBytes } from "node:crypto";

/**
 * The token of one Confirm button (a withdrawal V1-14, a payment from a wallet V1-31): kept in
 * the session with the screen and spent before the send, so a second click on the same screen,
 * or an older Confirm, is a stale button. 8 hex characters, well within the 64 bytes of §4.4.
 */
export const newConfirmToken = (): string => randomBytes(4).toString("hex");

/**
 * The nonce of an admin confirmation (V1-42, V1-43): `length` base64url characters, which the
 * callback codec accepts. 8 for a /grant, 16 for the Reveal keys of a /getall.
 */
export const newNonce = (length: 8 | 16): string =>
  randomBytes((length * 3) / 4).toString("base64url");
