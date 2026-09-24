import { describe, expect, it } from "vitest";
import { buildPnlCardSvg, CARD_HEIGHT, CARD_WIDTH } from "./card.js";
import { pnlCard as card } from "./test-helpers.js";

const count = (svg: string, needle: string): number => svg.split(needle).length - 1;

describe("buildPnlCardSvg", () => {
  it("is a transparent overlay of the clip size with the ticker and the rows, no DEMO band", () => {
    const svg = buildPnlCardSvg(card(), null);

    expect(
      svg.startsWith(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"><defs>`,
      ),
    ).toBe(true);
    expect(svg).toContain('class="veil"');
    expect(svg).not.toContain("DEMO");
    expect(svg).toContain('class="ticker">$OTTR</text>');
    expect(svg).toContain('class="pnl-sol">+1.283</text>');
    const rows = [...svg.matchAll(/class="(?:row-label|row-value|sol-amount)">([^<]+)</g)].map(
      (match) => match[1],
    );
    expect(rows).toEqual(["PNL", "+42.7%", "Invested", "3.000", "Position", "4.283"]);
    expect(svg).toContain('class="not-real">SIMULATION · Not a real result</text>');
    // The Solana mark: on the pill and before the two SOL amounts.
    expect(count(svg, 'class="sol-glyph"')).toBe(3);
  });

  it("colors the pill green on a gain, red on a loss", () => {
    expect(buildPnlCardSvg(card(), null)).toMatch(/fill="#22c55e" rx="20" class="pill"/);
    const loss = buildPnlCardSvg(
      card({ pnlSolBig: "-0.540", pnlPctText: "-18.0%", tone: "negative" }),
      null,
    );
    expect(loss).toMatch(/fill="#ef4444" rx="20" class="pill"/);
    expect(loss).toContain('class="pnl-sol">-0.540</text>');
  });

  it("shows the logo top right when there is one, the badge otherwise", () => {
    expect(buildPnlCardSvg(card(), null)).toContain(">O</text>");
    const svg = buildPnlCardSvg(card(), { href: "data:image/png;base64,/9j/" });
    expect(svg).toContain('<image href="data:image/png;base64,/9j/"');
    expect(svg).not.toContain('class="badge"');
  });
});
