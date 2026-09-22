import { inspect } from "node:util";
import { CENSOR } from "@launchbot/shared/server";

/**
 * Bytes that must never be printed: a 64-byte secret key, a seed. Logged, stringified or
 * inspected, they read `[REDACTED]`; `dispose()` zeroes them once the caller is done. Erasure
 * is best effort in JavaScript (a library may keep its own copy until the GC runs), which is
 * why a secret is kept for the time of one operation only, never in a session or a log.
 */
export class SecretBytes extends Uint8Array {
  /** Takes the bytes over: the source is copied, then zeroed. */
  static take(source: Uint8Array): SecretBytes {
    const secret = new SecretBytes(source.length);
    secret.set(source);
    source.fill(0);
    return secret;
  }

  dispose(): void {
    this.fill(0);
  }

  override toString(): string {
    return CENSOR;
  }

  toJSON(): string {
    return CENSOR;
  }

  [inspect.custom](): string {
    return CENSOR;
  }
}

/** Proposal: a result that holds a secret prints `[REDACTED]` as a whole, like `SecretBytes`. */
export function redacted<T extends object>(value: T): T {
  const hide = { value: () => CENSOR, enumerable: false };
  return Object.defineProperties(value, {
    toJSON: hide,
    toString: hide,
    [inspect.custom]: hide,
  });
}
