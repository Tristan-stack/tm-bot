/* eslint-disable no-console -- a sample for a human to look at (proposal, V1-25). */
/**
 * `pnpm --filter @launchbot/sim-render render:sample [seed] [outDir]`: renders the chart of
 * a real run (1 SOL dev buy + 3 SOL bundle) at 0 s and 90 s, plus the PNL card (an MP4) after a Sell 100% at 90 s, into
 * `out/` (ignored by git), to check the pictures on a phone before wiring them in the bot.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createCandleAggregator,
  createSimulation,
  FALLBACK_CURVE_PARAMS,
  presetForAmount,
} from "@launchbot/sim-engine";
import type { SimConfig } from "@launchbot/sim-engine";
import { buildPnlCardModel, renderChartPng, renderPnlCardVideo } from "../src/index.js";

const seed = Number(process.argv[2] ?? "42");
const outDir = process.argv[3] ?? join(import.meta.dirname, "..", "out");
const config: SimConfig = {
  seed,
  devBuySol: 1,
  bundleSol: 3,
  durationSec: 180,
  curve: FALLBACK_CURVE_PARAMS,
  preset: presetForAmount(3),
  solUsdPrice: 150,
};
const token = { name: "Moon Otter", ticker: "OTTR" };

const run = createSimulation(config);
const aggregator = createCandleAggregator({
  initialPrice: config.curve.virtualSol / config.curve.virtualTokens,
  durationSec: config.durationSec,
});
aggregator.push(run.openingBuys(), 0);

mkdirSync(outDir, { recursive: true });
const frameAt = (nowSec: number) => ({
  token,
  clock: { nowSec, durationSec: config.durationSec },
  candles: aggregator.candles(),
  config,
  logo: null,
});

const save = (name: string, png: Uint8Array): void => {
  writeFileSync(join(outDir, name), png);
  console.log(`${name}: ${png.byteLength} bytes`);
};

save("chart-0s.png", await renderChartPng(frameAt(0)));
aggregator.push(run.advanceTo(90), 90);
save("chart-90s.png", await renderChartPng(frameAt(90)));
const sale = run.sellDev(1);
aggregator.push([sale.event, ...sale.panic], 90);
save("chart-sold.png", await renderChartPng(frameAt(90)));
const card = buildPnlCardModel({ position: run.position(), config, token });
save("card.mp4", await renderPnlCardVideo(card, null));
console.log(card);
