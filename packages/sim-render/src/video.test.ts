import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_WIDTH } from "./card.js";
import { pnlCard } from "./test-helpers.js";
import { ffmpeg, renderPnlCardVideo, withScratch } from "./video.js";

/** The `ftyp` box right after its 4-byte size: the signature of an MP4 file. */
const isMp4 = (bytes: Uint8Array): boolean =>
  new TextDecoder().decode(bytes.subarray(4, 8)) === "ftyp";

/** The RGB of one pixel of the frame of the video at `atSec`. */
async function pixelAt(mp4: Uint8Array, atSec: number, x: number, y: number) {
  return withScratch(async (dir) => {
    const input = join(dir, "card.mp4");
    const output = join(dir, "frame.rgb");
    await writeFile(input, mp4);
    await ffmpeg([
      "-ss",
      String(atSec),
      "-i",
      input,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      output,
    ]);
    const rgb = await readFile(output);
    const offset = (y * CARD_WIDTH + x) * 3;
    return { r: rgb[offset]!, g: rgb[offset + 1]!, b: rgb[offset + 2]! };
  });
}

describe("renderPnlCardVideo", () => {
  it("composes the card over the clip into an MP4 without sound, the pill visible once faded in", async () => {
    const started = performance.now();
    const mp4 = await renderPnlCardVideo(pnlCard(), null);
    const elapsed = performance.now() - started;

    expect(isMp4(mp4)).toBe(true);
    expect(mp4.byteLength).toBeGreaterThan(200_000);
    expect(mp4.byteLength).toBeLessThan(5_000_000);
    expect(elapsed).toBeLessThan(15_000);

    // Inside the green pill (x 64 to 468, y 204 to 312), away from the glyph and the digits.
    const pill = await pixelAt(mp4, 3, 450, 280);
    expect(pill.g).toBeGreaterThan(150);
    expect(pill.r).toBeLessThan(100);
  }, 30_000);
});
