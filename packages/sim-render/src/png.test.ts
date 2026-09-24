import { describe, expect, it } from "vitest";
import { renderChartPng, renderLogo, renderPng } from "./png.js";
import { HEIGHT, WIDTH } from "./svg.js";
import { chartFrame } from "./test-helpers.js";

/** A 1 × 1 red PNG: the smallest logo resvg can embed. */
const RED_PIXEL = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const frame = chartFrame();

/** Width and height of the IHDR chunk, right after the 8-byte signature. */
const pngSize = (png: Uint8Array): { width: number; height: number } => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

describe("renderPng", () => {
  it("renders the chart to a PNG of the canvas size, deterministically", async () => {
    const started = performance.now();
    const png = await renderChartPng(frame);
    const elapsed = performance.now() - started;

    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(png)).toEqual({ width: WIDTH, height: HEIGHT });
    expect(png.byteLength).toBeGreaterThan(10_000);
    expect(png.byteLength).toBeLessThan(400_000);
    expect(elapsed).toBeLessThan(2000);

    const again = await renderChartPng(frame);
    expect(Buffer.compare(Buffer.from(again), Buffer.from(png))).toBe(0);
  });

  it("shrinks a logo once to a 96 px PNG data URI, and embeds it in the chart", async () => {
    const logo = await renderLogo({ bytes: RED_PIXEL, type: "image/png" });
    expect(logo.href.startsWith("data:image/png;base64,")).toBe(true);
    const thumbnail = Buffer.from(logo.href.slice("data:image/png;base64,".length), "base64");
    expect(pngSize(thumbnail)).toEqual({ width: 96, height: 96 });
    expect(thumbnail.byteLength).toBeLessThan(2000);

    const plain = await renderChartPng(frame);
    const withLogo = await renderChartPng(chartFrame({ logo }));

    expect(pngSize(plain)).toEqual({ width: WIDTH, height: HEIGHT });
    expect(pngSize(withLogo)).toEqual({ width: WIDTH, height: HEIGHT });
    expect(Buffer.compare(Buffer.from(plain), Buffer.from(withLogo))).not.toBe(0);
  });

  it("rejects a malformed SVG instead of returning an empty picture", async () => {
    await expect(renderPng("<svg")).rejects.toThrow();
  });
});
