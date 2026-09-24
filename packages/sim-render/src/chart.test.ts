import { createCandleAggregator, createSimulation } from "@launchbot/sim-engine";
import type { Candle } from "@launchbot/sim-engine";
import { simConfig } from "@launchbot/sim-engine/test-helpers";
import { describe, expect, it } from "vitest";
import { buildChartSvg, formatAxisValue } from "./chart.js";
import { HEIGHT, WIDTH } from "./svg.js";
import { candle, chartFrame as frame } from "./test-helpers.js";

const count = (svg: string, needle: string): number => svg.split(needle).length - 1;

/** The candles of a real run, as the runner will feed them. */
function realCandles(nowSec: number): readonly Candle[] {
  const config = simConfig();
  const run = createSimulation(config);
  const aggregator = createCandleAggregator({
    initialPrice: config.curve.virtualSol / config.curve.virtualTokens,
    durationSec: config.durationSec,
  });
  aggregator.push([run.devBuy()], 0);
  aggregator.push(run.advanceTo(nowSec), nowSec);
  return aggregator.candles();
}

describe("formatAxisValue", () => {
  it("drops the decimals a reader does not need", () => {
    expect(formatAxisValue(5175.82, "USD")).toBe("$5,176");
    expect(formatAxisValue(52.1, "USD")).toBe("$52.10");
    expect(formatAxisValue(52.1, "SOL")).toBe("52.10 SOL");
    expect(formatAxisValue(152.14, "SOL")).toBe("152.1 SOL");
  });
});

describe("buildChartSvg", () => {
  it("is a document of the canvas size with the DEMO band, the token and the clock", () => {
    const svg = buildChartSvg(frame());

    expect(
      svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"`),
    ).toBe(true);
    expect(svg).toContain("DEMO — Bullish scenario. Not a prediction or a real result.");
    expect(svg).toContain('class="demo-band"');
    expect(svg).toContain(">Moon Otter · $OTTR</text>");
    expect(svg).toContain(">1:32 / 3:00</text>");
    expect(svg).toContain(">Market cap (USD)</text>");
  });

  it("draws one candle per interval, green when it closed up, red otherwise, with its volume", () => {
    const svg = buildChartSvg(frame());

    expect(count(svg, '<g class="candle up">')).toBe(1);
    expect(count(svg, '<g class="candle down">')).toBe(1);
    expect(count(svg, 'class="volume"')).toBe(2);
    expect(svg).toContain('fill="#26a69a"');
    expect(svg).toContain('fill="#ef5350"');
  });

  it("fixes the time axis on the whole duration: a label every 30 s from 0:00 to 3:00", () => {
    const svg = buildChartSvg(frame());

    const ticks = [...svg.matchAll(/class="time-tick">([^<]+)</g)].map((match) => match[1]);
    expect(ticks).toEqual(["0:00", "0:30", "1:00", "1:30", "2:00", "2:30", "3:00"]);
    // The 36th slot ends at the right edge: a candle at 175 s sits inside the plot.
    const late = buildChartSvg(frame({ candles: [candle(175, 1e-8, 2e-8)] }));
    const x = Number(/<g class="candle up"><line x1="([\d.]+)"/.exec(late)?.[1]);
    expect(x).toBeGreaterThan(1100);
    expect(x).toBeLessThan(1150);
  });

  it("labels the value axis in USD with a price, in SOL without", () => {
    const usd = buildChartSvg(frame());
    const labels = [...usd.matchAll(/class="value-tick">([^<]+)</g)].map((match) => match[1]);
    expect(labels).toHaveLength(5);
    for (const label of labels) expect(label?.startsWith("$")).toBe(true);

    const sol = buildChartSvg(frame({ config: simConfig({ solUsdPrice: null }) }));
    expect(sol).toContain(">Market cap (SOL)</text>");
    for (const match of sol.matchAll(/class="value-tick">([^<]+)</g)) {
      expect(match[1]?.endsWith(" SOL")).toBe(true);
    }
  });

  it("escapes the name of the token, and never breaks on no candle", () => {
    const svg = buildChartSvg(frame({ token: { name: 'A & <b>"x"</b>', ticker: "X" } }));
    expect(svg).toContain(">A &amp; &lt;b&gt;&quot;x&quot;&lt;/b&gt; · $X</text>");
    expect(svg).not.toContain("<b>");

    expect(() => buildChartSvg(frame({ candles: [] }))).not.toThrow();
  });

  it("shows the logo as an embedded image, or a badge with the first letter of the ticker", () => {
    const badge = buildChartSvg(frame());
    expect(badge).toContain('class="badge"');
    expect(badge).toContain(">O</text>");

    const logo = buildChartSvg(frame({ logo: { href: "data:image/png;base64,AQID" } }));
    expect(logo).toContain('<image href="data:image/png;base64,AQID"');
    expect(logo).toContain('class="logo"');
    expect(logo).not.toContain('class="badge"');
  });

  it("draws the candles of a real run at 90 s: the dev buy first, all inside the plot", () => {
    const candles = realCandles(90);
    const svg = buildChartSvg(frame({ candles, clock: { nowSec: 90, durationSec: 180 } }));

    expect(candles[0]?.time).toBe(0);
    expect(candles.length).toBe(19);
    expect(count(svg, '<g class="candle ')).toBe(19);
    for (const match of svg.matchAll(
      /<line x1="([\d.]+)" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)" stroke="#(?:26a69a|ef5350)"/g,
    )) {
      const [, x, y1, y2] = match;
      expect(Number(x)).toBeGreaterThan(32);
      expect(Number(x)).toBeLessThan(1150);
      expect(Number(y1)).toBeGreaterThanOrEqual(138);
      expect(Number(y2)).toBeLessThanOrEqual(536);
    }
  });
});
