import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@launchbot/solana", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@launchbot/solana");
  });
});
