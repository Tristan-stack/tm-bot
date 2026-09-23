import { rangeError } from "./errors.js";

/**
 * Seeded generator: sfc32 (public domain, passes PractRand) seeded by SplitMix32 (proposal,
 * V1-18). Only `Math.imul`, `| 0`, `>>>`, `^` and `<<` are used, so the sequence is bit for
 * bit the same on every engine.
 */
export interface Rng {
  /** Next integer in [0, 2^32 − 1]. */
  nextUint32(): number;
  /** Next float in [0, 1). */
  next(): number;
  /** Next float in (0, 1], safe for a logarithm. */
  nextOpenClosed(): number;
  /** Next integer in [0, maxExclusive − 1]. */
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

const UINT32_MAX = 0xffffffff;
const TWO_POW_32 = 4294967296;
const WARM_UP_ROUNDS = 15;

/** A seed is a uint32: a `Simulation.seed` (int4, V1-02) is a valid subset. */
export function isValidSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}

function assertSeed(seed: unknown, name = "seed"): asserts seed is number {
  if (!isValidSeed(seed)) throw rangeError(name, "an integer in [0, 4294967295]");
}

/** One SplitMix32 step: the advanced state and its output. */
function splitmix32(state: number): { state: number; value: number } {
  const next = (state + 0x9e3779b9) | 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return { state: next, value: (z ^ (z >>> 16)) >>> 0 };
}

export function createRng(seed: number): Rng {
  assertSeed(seed);
  let mix = splitmix32(seed | 0);
  let a = mix.value;
  mix = splitmix32(mix.state);
  let b = mix.value;
  mix = splitmix32(mix.state);
  let c = mix.value;
  mix = splitmix32(mix.state);
  let d = mix.value;

  const nextUint32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < WARM_UP_ROUNDS; i += 1) nextUint32();

  const next = (): number => nextUint32() / TWO_POW_32;
  return {
    nextUint32,
    next,
    nextOpenClosed: () => 1 - next(),
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
        throw rangeError("maxExclusive", "an integer ≥ 1");
      }
      return Math.floor(next() * maxExclusive);
    },
    pick(items) {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw rangeError("items", "a non-empty list");
      return item;
    },
  };
}

/**
 * The seed of a sub-stream (arrivals, sides, sizes, traders… in V1-19): the SplitMix32
 * output of the seed mixed with the stream id.
 */
export function deriveSeed(seed: number, streamId: number): number {
  assertSeed(seed);
  if (!Number.isInteger(streamId) || streamId < 0) throw rangeError("streamId", "an integer ≥ 0");
  return splitmix32((seed ^ Math.imul(streamId + 1, 0x9e3779b9)) >>> 0).value;
}
