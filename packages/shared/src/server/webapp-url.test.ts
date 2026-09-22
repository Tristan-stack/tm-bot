import { describe, expect, it } from "vitest";
import { buildWebAppUrl } from "./webapp-url.js";

const WEBAPP_URL = "https://launchbot.example.com";

describe("buildWebAppUrl", () => {
  it("builds the URL of a page of the Mini App from WEBAPP_URL", () => {
    expect(buildWebAppUrl("/terms", WEBAPP_URL)).toBe("https://launchbot.example.com/terms");
    expect(buildWebAppUrl("/sim/cjld2cjxh0000qzrmn831i7rn", WEBAPP_URL)).toBe(
      "https://launchbot.example.com/sim/cjld2cjxh0000qzrmn831i7rn",
    );
  });

  it("only accepts the pages the Mini App serves (checked by tsc)", () => {
    // @ts-expect-error "/admin" is not a page of the Mini App
    buildWebAppUrl("/admin", WEBAPP_URL);
  });
});
