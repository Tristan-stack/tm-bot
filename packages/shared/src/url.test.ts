import { describe, expect, it } from "vitest";
import { joinUrl, withoutTrailingSlash } from "./url.js";

describe("joinUrl", () => {
  it.each([
    ["https://app.example", "/terms", "https://app.example/terms"],
    ["https://app.example/", "/terms", "https://app.example/terms"],
    ["https://app.example//", "terms", "https://app.example/terms"],
    ["https://app.example/base", "//sim/abc", "https://app.example/base/sim/abc"],
    // An empty base gives a path relative to the origin: the API behind the same tunnel.
    ["", "/api/simulations/x", "/api/simulations/x"],
  ])("joins %j and %j", (base, path, expected) => {
    expect(joinUrl(base, path)).toBe(expected);
  });
});

describe("withoutTrailingSlash", () => {
  it.each([
    ["https://app.example/", "https://app.example"],
    ["/terms//", "/terms"],
    ["/terms", "/terms"],
    ["/", ""],
  ])("turns %j into %j", (value, expected) => {
    expect(withoutTrailingSlash(value)).toBe(expected);
  });
});
