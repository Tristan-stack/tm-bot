import { describe, expect, it } from "vitest";
import {
  OTHER_BOT_TOKEN,
  signInitData,
  telegramUserField,
  TEST_BOT_TOKEN as BOT_TOKEN,
} from "../test-helpers/sign-init-data.js";
import { signDataCheckString, validateInitData } from "./init-data.js";

const NOW = new Date("2026-09-21T12:00:00Z");
const nowSec = NOW.getTime() / 1000;
const options = { maxAgeSec: 3600, now: NOW };

const signed = (fields: Record<string, string> = {}, token = BOT_TOKEN) =>
  signInitData({ auth_date: String(nowSec), user: telegramUserField(), ...fields }, token);

/** Changes one field after the signature, keeping the original hash. */
function tamper(raw: string, key: string, value: string): string {
  const params = new URLSearchParams(raw);
  params.set(key, value);
  return params.toString();
}

describe("validateInitData", () => {
  it("matches a signature computed from the Telegram documentation alone", () => {
    // Every other test signs with the code under test, so it would not see two HMAC arguments
    // swapped. This hash was computed apart from it: secret = HMAC-SHA256(key "WebAppData",
    // message BOT_TOKEN), then HMAC-SHA256(key secret) over the fields sorted by key and
    // joined with a line feed.
    const raw = new URLSearchParams({
      user: JSON.stringify({ id: 5_000_000_001, first_name: "Tristan", username: "tristan" }),
      query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
      auth_date: "1790000000",
      hash: "71b46339901cde89be6f2dcc824054575d4bfa90fdf242d28e194ea4ec59c8da",
    }).toString();

    const result = validateInitData(raw, BOT_TOKEN, {
      maxAgeSec: 3600,
      now: new Date(1_790_000_000 * 1000),
    });

    expect(result).toMatchObject({ ok: true, user: { id: 5_000_000_001 } });
  });

  it("accepts data signed by Telegram for this bot", () => {
    const result = validateInitData(
      signed({ user: telegramUserField({ last_name: "G", language_code: "fr" }), query_id: "AAE" }),
      BOT_TOKEN,
      options,
    );

    expect(result).toEqual({
      ok: true,
      authDate: NOW,
      user: {
        id: 5_000_000_001,
        firstName: "Tristan",
        lastName: "G",
        username: "tristan",
        languageCode: "fr",
      },
    });
  });

  it("keeps a signature field in the signed string, as the documentation says", () => {
    const raw = signed({ signature: "third-party-signature" });

    expect(validateInitData(raw, BOT_TOKEN, options).ok).toBe(true);
    expect(validateInitData(tamper(raw, "signature", "other"), BOT_TOKEN, options)).toEqual({
      ok: false,
      reason: "bad_hash",
    });
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
  ])("reports %s as missing", (_label, raw) => {
    expect(validateInitData(raw, BOT_TOKEN, options)).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects data without a hash, or with a hash that is not a SHA-256", () => {
    const withoutHash = new URLSearchParams(signed());
    withoutHash.delete("hash");

    for (const raw of [withoutHash.toString(), tamper(signed(), "hash", "abc"), "garbage"]) {
      expect(validateInitData(raw, BOT_TOKEN, options)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("rejects a modified hash", () => {
    const raw = tamper(signed(), "hash", "0".repeat(64));

    expect(validateInitData(raw, BOT_TOKEN, options)).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejects a user altered after the signature", () => {
    const raw = tamper(signed(), "user", telegramUserField({ id: 42 }));

    expect(validateInitData(raw, BOT_TOKEN, options)).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("rejects data signed for another bot", () => {
    const raw = signed({}, OTHER_BOT_TOKEN);

    expect(validateInitData(raw, BOT_TOKEN, options)).toEqual({ ok: false, reason: "bad_hash" });
  });

  it("accepts data up to the maximum age, and rejects it one second later", () => {
    const atLimit = signed({ auth_date: String(nowSec - 3600) });
    const tooOld = signed({ auth_date: String(nowSec - 3601) });

    expect(validateInitData(atLimit, BOT_TOKEN, options).ok).toBe(true);
    expect(validateInitData(tooOld, BOT_TOKEN, options)).toEqual({ ok: false, reason: "expired" });
  });

  it("tolerates 60 s of clock drift, and rejects a date further in the future", () => {
    const drift = signed({ auth_date: String(nowSec + 60) });
    const future = signed({ auth_date: String(nowSec + 61) });

    expect(validateInitData(drift, BOT_TOKEN, options).ok).toBe(true);
    expect(validateInitData(future, BOT_TOKEN, options)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a missing or unreadable auth_date, even when the signature is valid", () => {
    // Signed without the field, so only the missing date can explain the refusal.
    const withoutDate = new URLSearchParams({ user: telegramUserField() });
    withoutDate.set("hash", signDataCheckString(withoutDate, BOT_TOKEN).toString("hex"));

    expect(validateInitData(withoutDate.toString(), BOT_TOKEN, options)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(validateInitData(signed({ auth_date: "yesterday" }), BOT_TOKEN, options)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(validateInitData(signed({ auth_date: "0" }), BOT_TOKEN, options)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it.each([
    ["no user field", { user: "" }],
    ["a user that is not JSON", { user: "{not json" }],
    ["a user without an id", { user: JSON.stringify({ first_name: "Tristan" }) }],
    ["a user with a negative id", { user: telegramUserField({ id: -5 }) }],
    ["a user without a first name", { user: JSON.stringify({ id: 1 }) }],
  ])("rejects %s", (_label, fields) => {
    expect(validateInitData(signed(fields), BOT_TOKEN, options)).toEqual({
      ok: false,
      reason: "no_user",
    });
  });

  it("uses the current clock by default", () => {
    const fresh = signInitData({ user: telegramUserField() }, BOT_TOKEN);

    expect(validateInitData(fresh, BOT_TOKEN, { maxAgeSec: 3600 }).ok).toBe(true);
  });
});
