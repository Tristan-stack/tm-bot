import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPnlCardSvg } from "./card.js";
import type { PnlCardModel } from "./model.js";
import { renderPng } from "./png.js";
import type { Logo } from "./svg.js";

/** The clip under the card: 1280 × 944, 30 fps, 5.8 s, no sound (`assets/`, proposal of 24/09/2026). */
const CLIP = fileURLToPath(new URL("../assets/pnl-card.mp4", import.meta.url));
/** The overlay fades in over this many seconds, from the first frame. */
const FADE_IN_AT_SEC = 0;
const FADE_IN_SEC = 0.4;

/**
 * The ffmpeg binary of `ffmpeg-static` (downloaded at install for the platform; CommonJS,
 * loaded like the pump SDK). Null on a platform it has no build for: the one on PATH then.
 */
const load = createRequire(import.meta.url);
const FFMPEG = (load("ffmpeg-static") as string | null) ?? "ffmpeg";

/** Runs ffmpeg with the arguments, quietly; rejects with its last lines of stderr. Exported for the tests. */
export function ffmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${String(code)}: ${stderr.trim()}`));
    });
  });
}

/** A scratch directory for one composition, removed whatever happens. Exported for the tests. */
export async function withScratch<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "launchbot-card-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The PNL card as an animation (§6.3): the overlay of `buildPnlCardSvg`, faded in over the
 * clip, as an MP4 without sound, the format Telegram plays in a loop as a GIF. About a
 * second of ffmpeg per card, once per simulation.
 */
export async function renderPnlCardVideo(
  card: PnlCardModel,
  logo: Logo | null,
): Promise<Uint8Array> {
  const overlay = await renderPng(buildPnlCardSvg(card, logo));
  return withScratch(async (dir) => {
    const overlayPath = join(dir, "overlay.png");
    const outPath = join(dir, "card.mp4");
    await writeFile(overlayPath, overlay);
    // The overlay is looped into a stream of frames: a lone frame at t = 0 would be faded out
    // and repeated, and the card would never show.
    await ffmpeg([
      "-i",
      CLIP,
      "-loop",
      "1",
      "-framerate",
      "30",
      "-i",
      overlayPath,
      "-filter_complex",
      `[1:v]format=rgba,fade=in:st=${FADE_IN_AT_SEC}:d=${FADE_IN_SEC}:alpha=1[card];[0:v][card]overlay=0:0:shortest=1:format=auto`,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    return new Uint8Array(await readFile(outPath));
  });
}

/** One frame of the clip at `atSec` with the overlay, as PNG: for the preview script and the tests. */
export async function compositeFrame(overlay: Uint8Array, atSec: number): Promise<Uint8Array> {
  return withScratch(async (dir) => {
    const overlayPath = join(dir, "overlay.png");
    const outPath = join(dir, "frame.png");
    await writeFile(overlayPath, overlay);
    await ffmpeg([
      "-ss",
      String(atSec),
      "-i",
      CLIP,
      "-i",
      overlayPath,
      "-filter_complex",
      "[0:v][1:v]overlay=0:0:format=auto",
      "-frames:v",
      "1",
      "-update",
      "1",
      outPath,
    ]);
    return new Uint8Array(await readFile(outPath));
  });
}
