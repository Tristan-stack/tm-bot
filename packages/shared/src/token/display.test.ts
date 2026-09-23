import { describe, expect, it } from "vitest";
import { formatLinkForDisplay, formatTicker, missingRequiredFields } from "./display.js";

describe("formatTicker", () => {
  it("prefixes the stored symbol with $", () => {
    expect(formatTicker("OTTR")).toBe("$OTTR");
  });
});

describe("missingRequiredFields (§5: name and ticker only)", () => {
  it.each([
    [{ name: null, symbol: "OTTR" }, ["name"]],
    [{ name: "Moon Otter", symbol: null }, ["ticker"]],
    [{ name: null, symbol: null }, ["name", "ticker"]],
    [{ name: "", symbol: "" }, ["name", "ticker"]],
    [{ name: "Moon Otter", symbol: "OTTR" }, []],
  ])("%j → %j", (draft, expected) => {
    expect(missingRequiredFields(draft)).toEqual(expected);
  });
});

describe("formatLinkForDisplay", () => {
  it("shows a website without https://, cut at 40 characters", () => {
    expect(formatLinkForDisplay("website", "https://moon.com")).toBe("moon.com");
    expect(formatLinkForDisplay("website", "https://moon.com/about")).toBe("moon.com/about");
    const long = `https://moon.com/${"a".repeat(50)}`;
    const shown = formatLinkForDisplay("website", long);
    expect(shown).toBe(`moon.com/${"a".repeat(30)}…`);
    expect(Array.from(shown).length).toBe(40);
    expect(formatLinkForDisplay("website", `https://moon.com/${"🚀".repeat(40)}`)).toBe(
      `moon.com/${"🚀".repeat(30)}…`,
    );
  });

  it("shows an X handle or a community", () => {
    expect(formatLinkForDisplay("x", "https://x.com/moonotter")).toBe("@moonotter");
    expect(formatLinkForDisplay("x", "https://x.com/i/communities/1234")).toBe("X community");
  });

  it("shows a Telegram username or a short invitation", () => {
    expect(formatLinkForDisplay("telegram", "https://t.me/moonotter")).toBe("t.me/moonotter");
    expect(formatLinkForDisplay("telegram", "https://t.me/+AbCdEfGhIjKlMnOp")).toBe("t.me/+AbCd…");
  });
});
