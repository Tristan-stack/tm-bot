import { describe, expect, it } from "vitest";
import { normalizeWalletName, walletNameIssue } from "./schemas.js";

describe("wallet name (§9.3)", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeWalletName("  My   main  wallet ")).toBe("My main wallet");
  });

  it("accepts 32 characters and refuses 33, emojis counted as one", () => {
    expect(walletNameIssue("a".repeat(32))).toBeNull();
    expect(walletNameIssue("a".repeat(33))).toEqual({ reason: "too_long", length: 33 });
    expect(walletNameIssue("🚀".repeat(32))).toBeNull();
    expect(walletNameIssue("🚀".repeat(33))).toEqual({ reason: "too_long", length: 33 });
  });

  it("counts the length after normalization", () => {
    expect(walletNameIssue(`  ${"a".repeat(32)}  `)).toBeNull();
  });

  it.each([
    ["an empty text", ""],
    ["spaces only", "   "],
  ])("refuses %s as empty", (_label, raw) => {
    expect(walletNameIssue(raw)).toEqual({ reason: "empty" });
  });

  it.each([
    ["a line break", "Main\nwallet"],
    ["a carriage return", "Main\r"],
    ["a tab", "Main\twallet"],
    ["a control character", "Main\u0007"],
  ])("refuses %s", (_label, raw) => {
    expect(walletNameIssue(raw)).toEqual({ reason: "invalid" });
  });
});
