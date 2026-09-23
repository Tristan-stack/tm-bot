import { describe, expect, it } from "vitest";
import { ACTIONS, ADJECTIVES, NOUNS, TAGLINES } from "./words.js";

/** §10.4 and the Terms: no promise of gain, no financial advice. */
const FINANCIAL_BLACKLIST = [
  "100x",
  "profit",
  "guaranteed",
  "invest",
  "gains",
  "pump",
  "rich",
  "money",
  "lambo",
];
/** Terms §11.2: a few brands and protected characters that memecoins borrow the most. */
const BRAND_BLACKLIST = ["doge", "pepe", "shiba", "bitcoin", "elon", "pikachu", "mario", "disney"];

const everything = [...ADJECTIVES, ...NOUNS, ...ACTIONS, ...TAGLINES].map((w) => w.toLowerCase());
/** Whole words: `pumpkin` is not `pump`. */
const mentions = (banned: string) =>
  everything.filter((text) => new RegExp(`\\b${banned}\\b`).test(text));

describe("token word lists", () => {
  it("holds enough combinations", () => {
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(100);
    expect(NOUNS.length).toBeGreaterThanOrEqual(100);
    expect(ACTIONS.length).toBeGreaterThanOrEqual(30);
    expect(TAGLINES.length).toBeGreaterThanOrEqual(20);
  });

  it.each([
    ["adjectives", ADJECTIVES],
    ["nouns", NOUNS],
  ])(
    "%s are ASCII letters in Title Case, 12 characters at most, without duplicates",
    (_l, list) => {
      for (const word of list) expect(word).toMatch(/^[A-Z][a-z]{2,11}$/);
      expect(new Set(list).size).toBe(list.length);
    },
  );

  it("actions are lower-case phrases without a final stop", () => {
    for (const action of ACTIONS) expect(action).toMatch(/^[a-z][a-z ]*[a-z]$/);
  });

  it("taglines are exactly one short sentence each", () => {
    for (const tagline of TAGLINES) {
      expect(tagline).toMatch(/^[A-Z][A-Za-z ,']*[.!]$/);
      expect(tagline.length).toBeLessThanOrEqual(40);
    }
    expect(new Set(TAGLINES).size).toBe(TAGLINES.length);
  });

  it.each(FINANCIAL_BLACKLIST)("never promises a gain: %s", (banned) => {
    expect(mentions(banned)).toEqual([]);
  });

  it.each(BRAND_BLACKLIST)("names no brand or protected character: %s", (banned) => {
    expect(mentions(banned)).toEqual([]);
  });

  it("catches a banned word inside a phrase", () => {
    expect(["a pump and dump"].filter((t) => /\bpump\b/.test(t))).toHaveLength(1);
  });
});
