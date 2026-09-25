import { randomBytes } from "node:crypto";

/**
 * The token of one Confirm button (a withdrawal V1-14, a payment from a wallet V1-31): kept in
 * the session with the screen and spent before the send, so a second click on the same screen,
 * or an older Confirm, is a stale button. 8 hex characters, well within the 64 bytes of §4.4.
 */
export const newConfirmToken = (): string => randomBytes(4).toString("hex");
