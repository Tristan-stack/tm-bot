import { fileURLToPath } from "node:url";
import { renderAsync } from "@resvg/resvg-js";
import { buildChartSvg } from "./chart.js";
import type { ChartFrame } from "./chart.js";
import { FONT_FAMILY } from "./svg.js";
import type { Logo, LogoImage } from "./svg.js";

/**
 * The font ships with the package (Inter, SIL OFL 1.1, `fonts/`): no system font is ever
 * loaded, so the same input gives the same PNG on every machine.
 */
const FONT_FILES = ["Inter-Regular.ttf", "Inter-Bold.ttf"].map((file) =>
  fileURLToPath(new URL(`../fonts/${file}`, import.meta.url)),
);

/** The side of the logo thumbnail: twice the radius it is drawn at, for sharp phones. */
const LOGO_SIZE = 96;

/**
 * Rasterizes an SVG to PNG at its own size. The raster runs on resvg's thread; the PNG
 * encoding (`asPng`, about 15 ms for a picture) is synchronous, on the event loop.
 */
export async function renderPng(svg: string): Promise<Uint8Array> {
  const image = await renderAsync(svg, {
    fitTo: { mode: "original" },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
  });
  return new Uint8Array(image.asPng());
}

export const renderChartPng = (frame: ChartFrame): Promise<Uint8Array> =>
  renderPng(buildChartSvg(frame));

/**
 * The logo of a token as Telegram gives it (up to 5 MB) shrunk once to a small PNG, so a
 * frame embeds a few kilobytes and resvg decodes a thumbnail, not the original, every 3 s.
 */
export async function renderLogo(image: LogoImage): Promise<Logo> {
  const href = `data:${image.type};base64,${Buffer.from(image.bytes).toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_SIZE}" height="${LOGO_SIZE}" viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}"><image href="${href}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" preserveAspectRatio="xMidYMid slice"/></svg>`;
  const png = await renderPng(svg);
  return { href: `data:image/png;base64,${Buffer.from(png).toString("base64")}` };
}
