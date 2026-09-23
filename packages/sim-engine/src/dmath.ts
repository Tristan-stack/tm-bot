import { rangeError } from "./errors.js";

/**
 * Deterministic ln, exp, sin and cos (proposal, V1-18). `Math.log/exp/sin/cos` are
 * "implementation-approximated" in ECMAScript: V8 and JavaScriptCore may differ on the
 * last bit and a simulation would then diverge between the bot and Telegram iOS. These
 * only use + − × ÷, `Math.sqrt`, `Math.floor` and `Math.abs`, which IEEE 754 defines
 * exactly, so they are bit for bit the same everywhere.
 */

const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;
const SQRT1_2 = 0.7071067811865476;
/** π/2 split as in fdlibm: 33 bits, so k·HALF_PI_HI is exact for every k below 2^20. */
const HALF_PI_HI = 1.5707963267341256;
/** The remainder π/2 − HALF_PI_HI, added to full precision. */
const HALF_PI_LO = 6.077100506506192e-11;
const HALF_PI = 1.5707963267948966;
/** Shared with the draws (Box-Muller) and the schedule (wave). */
export const TWO_PI = 6.283185307179586;
const TWO_POW_1023 = 8.98846567431158e307;
const SERIES_TERMS = 40;
/** A term this small no longer changes the sum: the loops stop there, deterministically. */
const NEGLIGIBLE = 1e-17;

/** 2^n for an integer n; two halves keep every intermediate representable. */
function pow2(n: number): number {
  if (n > 1023) return Infinity;
  if (n < -1074) return 0;
  const half = Math.floor(n / 2);
  return pow2Small(half) * pow2Small(n - half);
}

/** 2^n for |n| ≤ 537, by binary exponentiation. */
function pow2Small(n: number): number {
  let result = 1;
  let base = 2;
  let k = Math.abs(n);
  while (k > 0) {
    if (k % 2 === 1) result *= base;
    base *= base;
    k = Math.floor(k / 2);
  }
  return n < 0 ? 1 / result : result;
}

/** Natural logarithm: x = m·2^e with m in [√½, √2), then e·ln 2 + 2·atanh((m − 1)/(m + 1)). */
function ln(x: number): number {
  if (Number.isNaN(x) || x <= 0) throw rangeError("x", "a number > 0");
  if (x === Infinity) return Infinity;
  let m = x;
  let e = 0;
  // Halving and doubling are exact; a subnormal needs at most ~1100 rounds.
  while (m >= SQRT2) {
    m /= 2;
    e += 1;
  }
  while (m < SQRT1_2) {
    m *= 2;
    e -= 1;
  }
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = 0;
  for (let k = 1; k < SERIES_TERMS * 2; k += 2) {
    const contribution = term / k;
    sum += contribution;
    if (Math.abs(contribution) <= NEGLIGIBLE * Math.abs(sum)) break;
    term *= s2;
  }
  return e * LN2 + 2 * sum;
}

/** Exponential: x = n·ln 2 + r with |r| ≤ ln 2 / 2, Taylor series of exp(r), then ×2^n. */
function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (x === -Infinity) return 0;
  const n = Math.floor(x / LN2 + 0.5);
  if (n > 1024) return Infinity;
  if (n < -1100) return 0;
  const r = x - n * LN2;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < SERIES_TERMS; k += 1) {
    term *= r / k;
    sum += term;
    if (Math.abs(term) <= NEGLIGIBLE * Math.abs(sum)) break;
  }
  // 2^1024 overflows while exp(1024·ln 2 − 0.3) does not: scale in two steps.
  if (n > 1023) return sum * TWO_POW_1023 * pow2(n - 1023);
  return sum * pow2(n);
}

/** sin and cos of a reduced argument |r| ≤ π/4, by Taylor series. */
function sinCosReduced(r: number): { sin: number; cos: number } {
  const r2 = r * r;
  let sin = r;
  let cos = 1;
  let sinTerm = r;
  let cosTerm = 1;
  for (let k = 1; k < SERIES_TERMS; k += 1) {
    cosTerm *= -r2 / (2 * k - 1) / (2 * k);
    sinTerm *= -r2 / (2 * k) / (2 * k + 1);
    cos += cosTerm;
    sin += sinTerm;
    if (Math.abs(sinTerm) <= NEGLIGIBLE && Math.abs(cosTerm) <= NEGLIGIBLE) break;
  }
  return { sin, cos };
}

/** The quadrant q in {0, 1, 2, 3} and the reduced argument r: x = q·π/2 + r (mod 2π). */
function reduce(x: number): { quadrant: number; r: number } {
  const k = Math.floor(x / HALF_PI + 0.5);
  const r = x - k * HALF_PI_HI - k * HALF_PI_LO;
  return { quadrant: ((k % 4) + 4) % 4, r };
}

/** sin of x = q·π/2 + r: the series of r, rotated by the quadrant; cos is sin a quadrant on. */
function fromQuadrant(quadrant: number, t: { sin: number; cos: number }): number {
  switch (quadrant % 4) {
    case 0:
      return t.sin;
    case 1:
      return t.cos;
    case 2:
      return -t.sin;
    default:
      return -t.cos;
  }
}

function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { quadrant, r } = reduce(x);
  return fromQuadrant(quadrant, sinCosReduced(r));
}

function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { quadrant, r } = reduce(x);
  return fromQuadrant(quadrant + 1, sinCosReduced(r));
}

/** `Math.min`/`Math.max` are IEEE-exact: a clamp is bit-identical everywhere. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const dmath = { ln, exp, sin, cos } as const;
