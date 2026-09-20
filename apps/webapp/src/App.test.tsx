import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("@launchbot/webapp", () => {
  it("renders the placeholder screen in a DOM environment", () => {
    expect(typeof document).toBe("object");
    expect(renderToStaticMarkup(<App />)).toContain("Launch Bot");
  });
});
