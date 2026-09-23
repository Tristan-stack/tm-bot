import { GENERATED_TICKER_LETTERS } from "../constants.js";
import { generatedTokenSchema, type GeneratedToken } from "./fields.js";
import { ACTIONS, ADJECTIVES, NOUNS, TAGLINES } from "./words.js";

export type { GeneratedToken };

/** The current draft, as stored: a column can be null. Only the name and the ticker matter. */
export type PreviousToken = { [K in keyof GeneratedToken]?: string | null };

export type GenerateLocalTokenOptions = {
  /** Uniform in `[0, 1)`. Default: `crypto.getRandomValues` (Node 20+ and browsers). */
  rng?: () => number;
  /** The current draft: the result differs from it on the name and on the ticker (§5). */
  previous?: PreviousToken | null;
};

/** Retries with the rng before the deterministic walk takes over (proposal). */
const RANDOM_TRIES = 20;
const TICKER_STRATEGIES = 3;

const cryptoRandom = (): number => {
  const [word] = globalThis.crypto.getRandomValues(new Uint32Array(1));
  return (word ?? 0) / 0x1_0000_0000;
};

const pick = <T>(rng: () => number, list: readonly T[]): T => {
  const item = list[Math.floor(rng() * list.length) % list.length];
  if (item === undefined) throw new Error("generateLocalToken: empty word list");
  return item;
};

const consonants = (upper: string): string => upper.replace(/[AEIOU]/g, "");
const vowels = (upper: string): string => upper.replace(/[^AEIOU]/g, "");
const dedupe = (upper: string): string => upper.replace(/(.)\1+/g, "$1");

/**
 * Three ways to shorten `<Adjective> <Noun>` into letters, chosen at random (proposal):
 * 0 – skeleton of the noun, first letter + consonants: Otter → `OTTR`;
 * 1 – initial of the adjective + start of the noun: Moon Otter → `MOTTER`;
 * 2 – both initials + consonants of the noun without repeats: → `MOTR`.
 */
function tickerOf(adjective: string, noun: string, strategy: number): string {
  const A = adjective.toUpperCase();
  const N = noun.toUpperCase();
  const { min, max } = GENERATED_TICKER_LETTERS;
  let letters: string;
  if (strategy === 0) letters = N.charAt(0) + consonants(N.slice(1));
  else if (strategy === 1) letters = A.charAt(0) + N.slice(0, max - 1);
  else letters = A.charAt(0) + N.charAt(0) + dedupe(consonants(N.slice(1)));
  // A short noun (Yak → `YK`) is padded with its vowels, in order.
  for (const vowel of vowels(N.slice(1))) {
    if (letters.length >= min) break;
    letters += vowel;
  }
  return letters.slice(0, max);
}

const VOWEL_SOUND = /^[aeiou]/i;
/** `a unicorn`, `a uniform`: an initial "uni" sounds like a consonant. */
const CONSONANT_SOUND = /^uni/i;
const article = (word: string): string =>
  VOWEL_SOUND.test(word) && !CONSONANT_SOUND.test(word) ? "An" : "A";

function describe(rng: () => number, adjective: string, noun: string): string {
  const subject = rng() < 0.5 ? `${adjective} ${noun}`.toLowerCase() : noun.toLowerCase();
  const sentences = [`${article(subject)} ${subject} who ${pick(rng, ACTIONS)}.`];
  const taglines = Math.floor(rng() * 3); // 0 to 2
  while (sentences.length <= taglines) {
    const tagline = pick(rng, TAGLINES);
    if (!sentences.includes(tagline)) sentences.push(tagline);
  }
  return sentences.join(" ");
}

function build(rng: () => number, adjective: string, noun: string, strategy: number) {
  return {
    name: `${adjective} ${noun}`,
    symbol: tickerOf(adjective, noun, strategy),
    description: describe(rng, adjective, noun),
  };
}

const differs = (token: GeneratedToken, previous: PreviousToken): boolean =>
  token.name !== previous.name && token.symbol !== previous.symbol;

/**
 * A complete token, different from `previous` on the name and on the ticker (§5 "Generate").
 * After a few random tries the combinations are walked in order from a random start, so the
 * guarantee never depends on luck. Every result is checked against the input validators: a
 * generated token must be accepted as typed.
 */
export function generateLocalToken(opts: GenerateLocalTokenOptions = {}): GeneratedToken {
  const rng = opts.rng ?? cryptoRandom;
  const previous = opts.previous ?? {};
  let token = build(rng, pick(rng, ADJECTIVES), pick(rng, NOUNS), Math.floor(rng() * 3));
  for (let tries = 1; tries < RANDOM_TRIES && !differs(token, previous); tries++) {
    token = build(rng, pick(rng, ADJECTIVES), pick(rng, NOUNS), Math.floor(rng() * 3));
  }
  if (!differs(token, previous)) {
    const combos = ADJECTIVES.length * NOUNS.length;
    const start = Math.floor(rng() * combos);
    walk: for (let step = 0; step < combos; step++) {
      const index = (start + step) % combos;
      const adjective = ADJECTIVES[index % ADJECTIVES.length] ?? ADJECTIVES[0];
      const noun = NOUNS[Math.floor(index / ADJECTIVES.length)] ?? NOUNS[0];
      for (let strategy = 0; strategy < TICKER_STRATEGIES; strategy++) {
        token = build(rng, adjective, noun, strategy);
        if (differs(token, previous)) break walk;
      }
    }
  }
  return generatedTokenSchema.parse(token);
}
