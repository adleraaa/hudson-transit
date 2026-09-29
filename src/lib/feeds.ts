import { createFeedCache, type CacheResult } from "./feed-cache";
import { decodeFeed } from "./mta";
import { fetchBytes, MTA_FEEDS, mtaFeedUrl, PATH_URL, type MtaFeed } from "./upstream";

/** Both upstreams update roughly every 15-30 s; refetching faster buys nothing. */
const TTL_MS = 20_000;
/** Beyond ~5 minutes predictions are misleading enough that an error is more honest. */
const MAX_STALE_MS = 5 * 60_000;

const options = { ttlMs: TTL_MS, maxStaleMs: MAX_STALE_MS };

export const getPathFeed = createFeedCache<unknown>(async () => {
  const bytes = await fetchBytes(PATH_URL);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
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
