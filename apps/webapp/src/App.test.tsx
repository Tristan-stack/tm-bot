import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { TERMS_VERSION } from "./config";
import { legalVersionLine } from "./legal";

const render = (path: string): string => renderToStaticMarkup(<App path={path} />);

describe("legal pages", () => {
  it("formats the version line of §11.2", () => {
    expect(legalVersionLine(1)).toBe("Version 1 · Updated 15 Sep 2026");
  });

  it("refuses a version that has no publication date", () => {
    expect(() => legalVersionLine(99)).toThrow(/No publication date/);
  });

  it("shows /terms with its version and the planned parts, outside Telegram too", () => {
    const html = render("/terms");

    expect(html).toContain("<h1>Terms of Service</h1>");
    expect(html).toContain(legalVersionLine(TERMS_VERSION));
    expect(html).toContain("<li>Inactive accounts</li>");
    expect(html).toContain("Draft — the full text will be published before launch.");
  });

  it("shows /privacy with the same version", () => {
    const html = render("/privacy");

    expect(html).toContain("<h1>Privacy Policy</h1>");
    expect(html).toContain(legalVersionLine(TERMS_VERSION));
    expect(html).toContain("<li>Retention</li>");
  });
});

describe("routes", () => {
  it("accepts a trailing slash", () => {
    expect(render("/terms/")).toContain("<h1>Terms of Service</h1>");
  });

  it.each(["/", "/unknown", "/sim", "/sim/abc", "/terms/extra"])(
    "answers Page not found for %s",
    (path) => {
      expect(render(path)).toContain("Page not found.");
    },
  );
});
