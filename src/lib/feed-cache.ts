export type CacheResult<T> = {
  value: T;
  /** When the value was fetched from upstream (epoch ms). */
  fetchedAt: number;
  /** True when the latest refresh failed and an older value is being served. */
  stale: boolean;
  error?: string;
};

export type FeedCacheOptions = {
  /** Serve cached data without contacting upstream for this long (also the retry backoff). */
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
 *   blank board when an upstream has a blip;
 * - failure backoff: after a failed refresh the next one waits a full TTL. Without it, a
 *   hung upstream makes every request after expiry wait for the fetch timeout (6 s) before
 *   getting the stale value, so the board stays up but becomes slow.
 *
 * The state lives in module memory, so it is per server instance, not global.
 */
export function createFeedCache<T>(load: () => Promise<T>, options: FeedCacheOptions) {
  const clock = options.now ?? (() => Date.now());
  let entry: { value: T; fetchedAt: number } | undefined;
  let failure: { error: unknown; at: number } | undefined;
  let inflight: Promise<CacheResult<T>> | undefined;

  /** The answer to give while upstream is failing: stale data if usable, else the error. */
  function fallback(error: unknown): CacheResult<T> {
    if (entry && clock() - entry.fetchedAt <= options.maxStaleMs) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...entry, stale: true, error: message };
    }
    throw error;
  }

  async function refresh(): Promise<CacheResult<T>> {
    try {
      const value = await load();
      entry = { value, fetchedAt: clock() };
      failure = undefined;
      return { ...entry, stale: false };
    } catch (err) {
      failure = { error: err, at: clock() };
      return fallback(err);
    }
  }

  return async function get(): Promise<CacheResult<T>> {
    if (entry && clock() - entry.fetchedAt < options.ttlMs) {
      return { ...entry, stale: false };
    }
    if (failure && clock() - failure.at < options.ttlMs) {
      return fallback(failure.error);
    }
    inflight ??= refresh().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };
}
