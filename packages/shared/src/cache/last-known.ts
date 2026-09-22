export type LastKnown<V> = {
  value: V;
  /** When this value was loaded. */
  loadedAt: number;
  /** The source is failing: this is the last value it gave. */
  isFallback: boolean;
};

export type LastKnownOptions<V> = {
  load: () => Promise<V>;
  /** How long an outcome stands before the source is asked again. */
  ttlMs: number;
  /** For a failed load: `ttlMs` by default. Shorter when a success is cached for long. */
  failureTtlMs?: number;
  /** How old the last value may be when it stands in for a failing source. Any age by default. */
  maxStaleMs?: number;
  onFailure?: (error: unknown) => void;
  now?: () => number;
};

/**
 * One shared value from a source that can fail (a price, a member count). What is cached is
 * the outcome of the attempt, failures included, so a source that is down is asked once per
 * TTL, not once per reader. While it fails, the last value stands in, and its age is measured
 * again on every read: the fallback itself is never cached. `null`: no usable value.
 */
export function createLastKnownValue<V>(
  options: LastKnownOptions<V>,
): () => Promise<LastKnown<V> | null> {
  const { load, ttlMs, failureTtlMs = ttlMs, maxStaleMs = Infinity, onFailure } = options;
  const now = options.now ?? Date.now;
  let last: { value: V; loadedAt: number } | undefined;
  let attempt: { at: number; succeeded: boolean } | undefined;
  let loading: Promise<void> | undefined;

  const isSettled = () =>
    attempt !== undefined && now() - attempt.at < (attempt.succeeded ? ttlMs : failureTtlMs);

  return async () => {
    if (!isSettled()) {
      // Concurrent readers share one load.
      loading ??= Promise.resolve()
        .then(load)
        .then((value) => {
          last = { value, loadedAt: now() };
          attempt = { at: now(), succeeded: true };
        })
        .catch((error: unknown) => {
          attempt = { at: now(), succeeded: false };
          onFailure?.(error);
        })
        .finally(() => (loading = undefined));
      await loading;
    }
    if (last === undefined) return null;
    if (attempt?.succeeded === true) return { ...last, isFallback: false };
    return now() - last.loadedAt < maxStaleMs ? { ...last, isFallback: true } : null;
  };
}
