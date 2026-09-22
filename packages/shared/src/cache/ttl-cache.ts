export type TtlCacheOptions = {
  ttlMs: number;
  /** For per-user caches: past it, the oldest entry is evicted. Unbounded by default. */
  maxEntries?: number;
  now?: () => number;
};

export type CachedEntry<V> = { value: V; storedAt: number };

export type TtlCache<K, V> = {
  /**
   * The cached value while it is younger than the TTL, the result of `loader` otherwise.
   * Concurrent calls for one key share a single load. A rejected load is not cached, and
   * rejects every caller that was waiting for it.
   */
  get: (key: K, loader: () => Promise<V>) => Promise<V>;
  /** The entry even once expired: what a fallback serves when the source is down. */
  peek: (key: K) => CachedEntry<V> | undefined;
  set: (key: K, value: V) => void;
  delete: (key: K) => void;
  clear: () => void;
};

/** Proposal (V1-07): bound of a cache that holds one entry per user. */
export const PER_USER_CACHE_MAX_ENTRIES = 10_000;

/**
 * In the memory of the process (§4.3): the bot and the worker each have their own caches,
 * which is enough while a single instance of the bot runs.
 */
export function createTtlCache<K, V>(options: TtlCacheOptions): TtlCache<K, V> {
  const { ttlMs, maxEntries = Infinity, now = Date.now } = options;
  const entries = new Map<K, CachedEntry<V>>();
  const loading = new Map<K, Promise<V>>();

  function set(key: K, value: V): void {
    // Deleted first so the key moves to the end: the Map stays ordered from oldest to newest.
    entries.delete(key);
    entries.set(key, { value, storedAt: now() });
    if (entries.size > maxEntries) {
      for (const oldest of entries.keys()) {
        entries.delete(oldest);
        break;
      }
    }
  }

  return {
    set,
    peek: (key) => entries.get(key),
    delete: (key) => void entries.delete(key),
    clear: () => entries.clear(),

    get(key, loader) {
      const entry = entries.get(key);
      if (entry !== undefined && now() - entry.storedAt < ttlMs) {
        return Promise.resolve(entry.value);
      }
      const pending = loading.get(key);
      if (pending !== undefined) return pending;

      // Inside a promise, so a loader that throws rejects like one that returns a rejection.
      const load = new Promise<V>((resolve) => resolve(loader()))
        .then((value) => {
          set(key, value);
          return value;
        })
        .finally(() => loading.delete(key));
      loading.set(key, load);
      return load;
    },
  };
}
