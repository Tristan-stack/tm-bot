/** A buy on a curve whose real reserves are empty (proposal, V1-18). */
export class CurveCompleteError extends Error {
  constructor() {
    super("The bonding curve is complete: no token left to buy");
    this.name = "CurveCompleteError";
  }
}

/** A sell of the dev after the simulation ended (proposal, V1-20). */
export class SimulationEndedError extends Error {
  constructor() {
    super("The simulation has ended: the dev cannot sell any more");
    this.name = "SimulationEndedError";
  }
}

/** A value outside its domain, named after the field or the argument at fault. */
export const rangeError = (name: string, expected: string): RangeError =>
  new RangeError(`${name} must be ${expected}`);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isFinitePositive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** The number that `value` is if it satisfies `test`, otherwise a RangeError naming `name`. */
export function checkNumber(
  value: unknown,
  name: string,
  expected: string,
  test: (n: number) => boolean,
): number {
  if (typeof value !== "number" || !test(value)) throw rangeError(name, expected);
  return value;
}

/** The most common domain of the engine: amounts, rates, durations. */
export const checkPositive = (value: unknown, name: string): number =>
  checkNumber(value, name, "a finite number > 0", isFinitePositive);
