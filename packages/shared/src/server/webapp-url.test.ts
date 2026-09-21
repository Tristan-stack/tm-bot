import { describe, expect, it, vi } from "vitest";
import { buildWebAppUrl } from "./webapp-url.js";

vi.mock("./env.js", () => ({
  loadEnv: () => ({ WEBAPP_URL: "https://launchbot.example.com" }),
}));

describe("buildWebAppUrl", () => {
  it("builds the URL of a page of the Mini App from WEBAPP_URL", () => {
    expect(buildWebAppUrl("/terms")).toBe("https://launchbot.example.com/terms");
    expect(buildWebAppUrl("/sim/cjld2cjxh0000qzrmn831i7rn")).toBe(
      "https://launchbot.example.com/sim/cjld2cjxh0000qzrmn831i7rn",
    );
  });

  it("only accepts the pages the Mini App serves (checked by tsc)", () => {
    // @ts-expect-error "/admin" is not a page of the Mini App
    buildWebAppUrl("/admin");
  });
});
