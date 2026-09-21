import { describe, expect, it } from "vitest";
import { DEFAULT_TERMS_VERSION, LEGAL_UPDATED_AT, resolveTermsVersion } from "./legal.js";

describe("LEGAL_UPDATED_AT", () => {
  it("dates version 1 as the context does (§11.2)", () => {
    expect(LEGAL_UPDATED_AT[1]).toBe("2026-09-15");
  });

  it("holds ISO dates only, for every version", () => {
    for (const date of Object.values(LEGAL_UPDATED_AT)) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(date).getTime())).toBe(false);
    }
  });

  it("dates the default version: a build without TERMS_VERSION must work", () => {
    expect(LEGAL_UPDATED_AT[DEFAULT_TERMS_VERSION]).toBeDefined();
  });
});

describe("resolveTermsVersion", () => {
  it.each([
    [undefined, DEFAULT_TERMS_VERSION],
    ["", DEFAULT_TERMS_VERSION],
    ["   ", DEFAULT_TERMS_VERSION],
    ["1", 1],
    [" 1 ", 1],
  ])("resolves %j to version %d", (raw, expected) => {
    expect(resolveTermsVersion(raw)).toBe(expected);
  });

  // The same strings loadEnv refuses: the Mini App and the bot must agree on the version.
  it.each(["2", "99", "0", "-1", "1.0", "1e0", "one"])(
    "fails the build for %j, which has no publication date",
    (raw) => {
      expect(() => resolveTermsVersion(raw)).toThrow(/has no date in LEGAL_UPDATED_AT/);
    },
  );
});
