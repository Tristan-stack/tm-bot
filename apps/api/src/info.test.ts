import { describe, expect, it } from "vitest";
import { APP_NAME } from "./info.js";

describe("@launchbot/api", () => {
  it("exposes its app name", () => {
    expect(APP_NAME).toBe("@launchbot/api");
  });
});
