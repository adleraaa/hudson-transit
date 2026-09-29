import { createFeedCache, type CacheResult } from "./feed-cache";
import { decodeFeed } from "./mta";
import { readPathFeed, type PathFeed } from "./path";
import { fetchBytes, MTA_FEEDS, mtaFeedUrl, PATH_URL, type MtaFeed } from "./upstream";

/**
 * Predictions are counted in whole minutes on the board, so data up to 20 s old costs
 * little accuracy while every station request on this instance shares one upstream fetch.
 */
const TTL_MS = 20_000;
/** Beyond ~5 minutes predictions are misleading enough that an error is more honest. */
const MAX_STALE_MS = 5 * 60_000;

const options = { ttlMs: TTL_MS, maxStaleMs: MAX_STALE_MS };

// The shape check happens inside the loader on purpose: a wrong-shaped body then counts
// as a failed refresh (stale copy served) rather than replacing the last good value.
export const getPathFeed = createFeedCache<PathFeed>(async () => {
  const bytes = await fetchBytes(PATH_URL);
  return readPathFeed(JSON.parse(new TextDecoder().decode(bytes)));
}, options);

const mtaCaches = new Map(
  MTA_FEEDS.map((feed) => [
    feed,
    createFeedCache(async () => decodeFeed(await fetchBytes(mtaFeedUrl(feed))), options),
  ]),
);

export function getMtaFeed(feed: MtaFeed): Promise<CacheResult<ReturnType<typeof decodeFeed>>> {
  return mtaCaches.get(feed)!();
}
