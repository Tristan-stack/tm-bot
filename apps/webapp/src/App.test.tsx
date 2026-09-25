import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("answers Page not found: the Terms and Privacy pages were removed on 25/09/2026", () => {
    expect(renderToStaticMarkup(<App />)).toBe('<main class="page"><p>Page not found.</p></main>');
  });
});
