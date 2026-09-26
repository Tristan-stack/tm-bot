import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_ERRORS,
  publicError,
  readDefaultImageUrl,
  readStoredSession,
  readTelegramApp,
  sessionInstructions,
  sourceMessageFrom,
  stopsSignIn,
} from "./success-source.js";

const HASH = "0123456789abcdef0123456789abcdef";

describe("readTelegramApp", () => {
  it("reads the app id and hash and nothing of their values on failure", () => {
    expect(readTelegramApp({ TELEGRAM_API_ID: "12345", TELEGRAM_API_HASH: HASH })).toEqual({
      ok: true,
      app: { apiId: 12345, apiHash: HASH },
    });
    expect(readTelegramApp({ TELEGRAM_API_ID: "nope" })).toEqual({
      ok: false,
      reason: CREDENTIAL_ERRORS.id,
    });
    expect(readTelegramApp({ TELEGRAM_API_ID: "0", TELEGRAM_API_HASH: HASH })).toEqual({
      ok: false,
      reason: CREDENTIAL_ERRORS.id,
    });
    expect(readTelegramApp({ TELEGRAM_API_ID: "7" })).toEqual({
      ok: false,
      reason: CREDENTIAL_ERRORS.hash,
    });
  });
});

describe("stopsSignIn", () => {
  it("lets a wrong code be entered again", () => {
    expect(stopsSignIn(new Error("PHONE_CODE_INVALID"))).toBe(false);
    expect(stopsSignIn(new Error("PASSWORD_HASH_INVALID"))).toBe(false);
    expect(stopsSignIn(new Error("AUTH_KEY_UNREGISTERED"))).toBe(true);
  });
});

describe("publicError", () => {
  it("removes the phone and the api hash from a client error", () => {
    const phone = "+33612345678";
    const error = new Error(`auth failed for ${phone} ${HASH}`);
    expect(publicError(error, [phone, HASH])).toBe("auth failed for [REDACTED] [REDACTED]");
    expect(publicError("nope", [HASH])).toBe("Sign-in failed");
  });
});

describe("readDefaultImageUrl", () => {
  it("keeps an https URL and drops anything else", () => {
    const url = "https://cdn.example/logo.png";
    expect(readDefaultImageUrl({ DEFAULT_TOKEN_IMAGE_URL: `  ${url}  ` })).toBe(url);
    expect(readDefaultImageUrl({})).toBeUndefined();
    expect(readDefaultImageUrl({ DEFAULT_TOKEN_IMAGE_URL: "http://cdn.example/logo.png" })).toBe(
      undefined,
    );
  });
});

describe("readStoredSession", () => {
  it("ignores a blank session", () => {
    expect(readStoredSession({})).toBeUndefined();
    expect(readStoredSession({ TELEGRAM_SESSION: "  " })).toBeUndefined();
    expect(readStoredSession({ TELEGRAM_SESSION: "1Asession" })).toBe("1Asession");
  });
});

describe("sourceMessageFrom", () => {
  it("keeps the text of a card and skips a message with no date", () => {
    expect(sourceMessageFrom({ id: 20, date: 1_700_000_000, message: "🏆 $OTTR" })).toEqual({
      id: 20,
      text: "🏆 $OTTR",
    });
    expect(sourceMessageFrom({ id: 20, date: "nope", message: "🏆 $OTTR" })).toBeUndefined();
  });
});

describe("sessionInstructions", () => {
  it("puts the session alone on a line", () => {
    expect(sessionInstructions("1Asession")).toBe(
      "Add this to .env as TELEGRAM_SESSION. Do not commit it.\n\n1Asession\n",
    );
  });
});
