import { describe, expect, it } from "vitest";
import { TOKEN_DESCRIPTION_MAX_CHARS, TOKEN_NAME_MAX_BYTES } from "../constants.js";
import { utf8ByteLength } from "../format/text.js";
import { countSentences, generatedTokenSchema } from "./fields.js";
import { generateLocalToken } from "./generator.js";
import { ADJECTIVES, NOUNS } from "./words.js";

/** Deterministic rng for the tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUNS = 10_000;

describe("generateLocalToken", () => {
  it("stays within the limits over 10 000 generations with the default rng", () => {
    for (let i = 0; i < RUNS; i++) {
      const token = generateLocalToken();
      expect(utf8ByteLength(token.name)).toBeGreaterThanOrEqual(1);
      expect(utf8ByteLength(token.name)).toBeLessThanOrEqual(TOKEN_NAME_MAX_BYTES);
      expect(token.symbol).toMatch(/^[A-Z]{3,6}$/);
      expect(countSentences(token.description)).toBeGreaterThanOrEqual(1);
      expect(countSentences(token.description)).toBeLessThanOrEqual(3);
      expect(Array.from(token.description).length).toBeLessThanOrEqual(TOKEN_DESCRIPTION_MAX_CHARS);
      expect(generatedTokenSchema.safeParse(token)).toEqual({ success: true, data: token });
    }
  });

  it("never repeats the name or the ticker of the previous draft, 10 000 chained calls", () => {
    let previous = generateLocalToken();
    for (let i = 0; i < RUNS; i++) {
      const token = generateLocalToken({ previous });
      expect(token.name).not.toBe(previous.name);
      expect(token.symbol).not.toBe(previous.symbol);
      previous = token;
    }
  });

  it("differs from a partial previous draft too", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1_000; i++) {
      const token = generateLocalToken({ rng, previous: { symbol: "OTTR" } });
      expect(token.symbol).not.toBe("OTTR");
    }
  });

  it("offers variety: at least 1 000 distinct names in 2 000 draws", () => {
    const names = new Set<string>();
    for (let i = 0; i < 2_000; i++) names.add(generateLocalToken().name);
    expect(names.size).toBeGreaterThanOrEqual(1_000);
  });

  it("is reproducible with an injected rng", () => {
    const a = generateLocalToken({ rng: mulberry32(42) });
    const b = generateLocalToken({ rng: mulberry32(42) });
    expect(a).toEqual(b);
    expect(generateLocalToken({ rng: mulberry32(43) })).not.toEqual(a);
  });

  it("builds `<Adjective> <Noun>` from the lists and a ticker from the name", () => {
    const token = generateLocalToken({ rng: mulberry32(1) });
    const [adjective, noun] = token.name.split(" ");
    expect(ADJECTIVES).toContain(adjective);
    expect(NOUNS).toContain(noun);
    expect(token.symbol.charAt(0)).toMatch(
      new RegExp(`[${adjective?.charAt(0) ?? ""}${noun?.charAt(0) ?? ""}]`.toUpperCase()),
    );
  });

  it("writes the description with the right article", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i++) {
      const { description } = generateLocalToken();
      const first = description.split(" ", 2).join(" ");
      expect(first).toMatch(/^(A [^aeiou]|A uni|An [aeiou])/i);
      seen.add(first.split(" ")[0] ?? "");
    }
    expect([...seen].sort()).toEqual(["A", "An"]);
  });

  it("guarantees the difference without luck: a constant rng still moves on", () => {
    const stuck = () => 0.25;
    const first = generateLocalToken({ rng: stuck });
    const second = generateLocalToken({ rng: stuck, previous: first });
    expect(second.name).not.toBe(first.name);
    expect(second.symbol).not.toBe(first.symbol);
  });
});
