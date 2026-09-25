import { describe, expect, it } from "vitest";
import { PLANS } from "../constants.js";
import {
  buildSupportCode,
  buildSupportUrl,
  parseTelegramId,
  parseUserRef,
} from "./support-code.js";

describe("buildSupportCode (§11.1)", () => {
  it.each([
    ["PREMIUM", "P-123456789"],
    ["CLASSIC", "C-123456789"],
    [null, "F-123456789"],
  ] as const)("%s → %s", (plan, code) => {
    expect(buildSupportCode(plan, 123_456_789n)).toBe(code);
  });

  it("writes an id above 2^32 in full, from a bigint or a number", () => {
    expect(buildSupportCode("PREMIUM", 7_000_000_000n)).toBe("P-7000000000");
    expect(buildSupportCode(null, 7_000_000_000)).toBe("F-7000000000");
  });
});

describe("parseUserRef", () => {
  it.each([
    ["123456789", { telegramId: 123_456_789n, claimedPlanLetter: null }],
    ["P-123456789", { telegramId: 123_456_789n, claimedPlanLetter: "P" }],
    ["p-123456789", { telegramId: 123_456_789n, claimedPlanLetter: "P" }],
    ["C-123456789", { telegramId: 123_456_789n, claimedPlanLetter: "C" }],
    ["f-7000000000", { telegramId: 7_000_000_000n, claimedPlanLetter: "F" }],
    ["  P-123456789  ", { telegramId: 123_456_789n, claimedPlanLetter: "P" }],
    ["9007199254740993", { telegramId: 9_007_199_254_740_993n, claimedPlanLetter: null }],
  ])("reads %j", (raw, ref) => {
    expect(parseUserRef(raw)).toEqual(ref);
  });

  it.each([
    "X-123",
    "P123456789",
    "P-",
    "-123",
    "P-12a",
    "P- 123",
    "@username",
    "0",
    "P-0123",
    "-5",
    "12345678901234567",
    "",
    "   ",
  ])("refuses %j", (raw) => {
    expect(parseUserRef(raw)).toBeNull();
  });

  it("reads back every code it builds", () => {
    for (const plan of [...PLANS, null]) {
      const ref = parseUserRef(buildSupportCode(plan, 7_000_000_000n));
      expect(ref?.telegramId).toBe(7_000_000_000n);
      expect(ref?.claimedPlanLetter).toBe(plan === null ? "F" : plan[0]);
    }
  });

  it("reads a bare Telegram id the same way, and nothing else", () => {
    expect(parseTelegramId("123456789")).toBe(123_456_789n);
    for (const raw of ["P-123", " 123", "0", "01", "12345678901234567", "-5", ""]) {
      expect(parseTelegramId(raw)).toBeNull();
    }
  });
});

describe("buildSupportUrl", () => {
  const prefill = { prefill: true };

  it("pre-fills the first message of a t.me account with the code", () => {
    expect(buildSupportUrl("https://t.me/launchbot_support", "P-123456789", prefill)).toBe(
      "https://t.me/launchbot_support?text=P-123456789",
    );
    expect(buildSupportUrl("https://telegram.me/LaunchSupport", "F-1", prefill)).toBe(
      "https://telegram.me/LaunchSupport?text=F-1",
    );
  });

  it("adds the parameter to a query already there", () => {
    expect(buildSupportUrl("https://t.me/launchbot_support?ref=bot", "C-7", prefill)).toBe(
      "https://t.me/launchbot_support?ref=bot&text=C-7",
    );
  });

  it("uses start for a bot account", () => {
    expect(buildSupportUrl("https://t.me/LaunchSupportBot", "P-123456789", prefill)).toBe(
      "https://t.me/LaunchSupportBot?start=P-123456789",
    );
  });

  it("encodes the code with encodeURIComponent, never a +", () => {
    expect(buildSupportUrl("https://t.me/launchbot_support", "P 1&2", prefill)).toBe(
      "https://t.me/launchbot_support?text=P%201%262",
    );
  });

  it.each([
    "https://t.me/+AbCdEfGhIjKlMnOp",
    "https://t.me/joinchat/AbCdEfGhIjKlMnOp",
    "https://t.me/launchbot_support/12",
    "https://t.me/share",
    "https://example.com/support",
    "not a url",
  ])("leaves %s as it is", (url) => {
    expect(buildSupportUrl(url, "P-123456789", prefill)).toBe(url);
  });

  it("leaves the link as it is when the pre-fill is off", () => {
    expect(
      buildSupportUrl("https://t.me/launchbot_support", "P-123456789", { prefill: false }),
    ).toBe("https://t.me/launchbot_support");
  });
});
