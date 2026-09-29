export type CacheResult<T> = {
  value: T;
  /** When the value was fetched from upstream (epoch ms). */
  fetchedAt: number;
  /** True when the latest refresh failed and an older value is being served. */
  stale: boolean;
  error?: string;
};

export type FeedCacheOptions = {
  /** Serve cached data without contacting upstream for this long. */
  ttlMs: number;
  /** If upstream fails, keep serving the last good value until it is this old. */
  maxStaleMs: number;
  now?: () => number;
};

/**
 * A single-value cache around an upstream loader with:
 * - a short TTL, so all stations on one instance share one fetch + decode per feed;
 * - request coalescing, so 20 concurrent requests after expiry cause one upstream call;
 * - stale-if-error, because showing 2-minute-old predictions (clearly labeled) beats a
 *   blank board when an upstream has a blip.
 *
 * The state lives in module memory, so it is per server instance, not global.
 */
export function createFeedCache<T>(load: () => Promise<T>, options: FeedCacheOptions) {
  const clock = options.now ?? Date.now;
  let entry: { value: T; fetchedAt: number } | undefined;
  let inflight: Promise<CacheResult<T>> | undefined;

  async function refresh(): Promise<CacheResult<T>> {
    try {
      const value = await load();
      entry = { value, fetchedAt: clock() };
      return { ...entry, stale: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (entry && clock() - entry.fetchedAt <= options.maxStaleMs) {
        return { ...entry, stale: true, error: message };
      }
      throw err;
    }
  }

  return function get(): Promise<CacheResult<T>> {
    if (entry && clock() - entry.fetchedAt < options.ttlMs) {
      return Promise.resolve({ ...entry, stale: false });
    }
    inflight ??= refresh().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };
}
