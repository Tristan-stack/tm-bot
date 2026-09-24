/**
 * Pictures of the simulation in the chat (§6.1, §6.3, V1-25): the chart as PNG and the PNL
 * card as an animation over a clip, built as SVG in TypeScript (testable as text), rasterized
 * by resvg with a font shipped in the package, composed by ffmpeg. Node only: the bot
 * renders, Telegram displays.
 */
export type { ChartFrame } from "./chart.js";
export { buildPnlCardModel, buildPositionView } from "./model.js";
export type { PnlCardModel, PositionView, SimToken } from "./model.js";
export { renderChartPng, renderLogo } from "./png.js";
export type { Logo, LogoImage } from "./svg.js";
export { renderPnlCardVideo } from "./video.js";
