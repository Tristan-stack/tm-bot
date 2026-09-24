/* eslint-disable no-console -- a preview for a human to look at (V1-25). */
/**
 * `pnpm --filter @launchbot/sim-render preview:card [outDir]`: renders the PNL card overlay
 * over one frame of the clip (`assets/pnl-card.mp4`, at 3 s) and the whole animation, into
 * `out/`, to check the design before wiring it in the bot.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPnlCardSvg } from "../src/card.js";
import { renderPng } from "../src/png.js";
import { pnlCard } from "../src/test-helpers.js";
import { compositeFrame, renderPnlCardVideo } from "../src/video.js";

const outDir = process.argv[2] ?? join(import.meta.dirname, "..", "out");
mkdirSync(outDir, { recursive: true });

const gain = pnlCard();
const loss = pnlCard({
  pnlSolBig: "-0.540",
  pnlPctText: "-18.0%",
  investedText: "3.000",
  positionSolText: "2.460",
  usd: { invested: "$310", position: "$254", pnl: "-$56" },
  tone: "negative",
});

const save = (name: string, bytes: Uint8Array): void => {
  writeFileSync(join(outDir, name), bytes);
  console.log(`${name}: ${bytes.byteLength} bytes`);
};

save("card-gain-frame.png", await compositeFrame(await renderPng(buildPnlCardSvg(gain, null)), 3));
save(
  "card-loss-frame.png",
  await compositeFrame(await renderPng(buildPnlCardSvg(loss, null)), 5.5),
);
const started = performance.now();
save("card-gain.mp4", await renderPnlCardVideo(gain, null));
console.log(`video in ${Math.round(performance.now() - started)} ms`);
