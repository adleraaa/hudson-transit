import type { transit_realtime } from "gtfs-realtime-bindings";
import type { CacheResult } from "./feed-cache";
import { feedTimestamp, subwayArrivals } from "./mta";
import { parsePathFeed, PATH_STATIONS, type PathFeed } from "./path";
import type { Arrival, Board } from "./schema";
import { getComplex } from "./subway-data";
import { DEPARTED_GRACE_MS } from "./time";
import { feedsForRoute, MTA_FEEDS, type MtaFeed } from "./upstream";

export type BoardDeps = {
  getPathFeed: () => Promise<CacheResult<PathFeed>>;
  getMtaFeed: (feed: MtaFeed) => Promise<CacheResult<transit_realtime.FeedMessage>>;
  now: () => number;
};

/** Thrown when no upstream data (fresh or stale) is available for a station. */
export class BoardUnavailableError extends Error {}

const HORIZON_MS = 60 * 60_000;
/**
 * The cap is per route *and* direction, not per direction: at a hub like Times Sq the
 * 1/2/3, N/Q/R/W and A/C/E platforms all say "Uptown", and a per-direction cap let the
 * most frequent lines fill every slot so a whole line (e.g. the A) disappeared.
 */
const MAX_PER_ROUTE = 3;
/** GTFS-rt feeds normally carry a header timestamp seconds old; minutes means it is frozen. */
const FROZEN_FEED_MS = 2 * 60_000;

function feedLabel(feed: MtaFeed): string {
  return feed === "" ? "1-7/S" : feed.slice(1).toUpperCase();
}

/** Keeps the next hour of trains, at most MAX_PER_ROUTE per (direction, route), in time order. */
export function trim(arrivals: Arrival[], now: number): Arrival[] {
  const perRoute = new Map<string, number>();
  return arrivals
    .filter((a) => a.arrivalTime >= now - DEPARTED_GRACE_MS && a.arrivalTime <= now + HORIZON_MS)
    .sort((a, b) => a.arrivalTime - b.arrivalTime)
    .filter((a) => {
      const key = `${a.direction}\u0000${a.route}`;
      const n = perRoute.get(key) ?? 0;
      perRoute.set(key, n + 1);
      return n < MAX_PER_ROUTE;
    });
}

async function buildPathBoard(stationId: string, code: string, deps: BoardDeps): Promise<Board> {
  let feed: CacheResult<PathFeed>;
  try {
    feed = await deps.getPathFeed();
  } catch (err) {
    throw new BoardUnavailableError(`PATH data unavailable: ${(err as Error).message}`);
  }
  const now = deps.now();
  const { arrivals, skipped } = parsePathFeed(feed.value, code);
  const warnings: string[] = [];
  if (feed.stale) warnings.push(`PATH feed refresh failed (${feed.error}); showing cached data.`);
  if (skipped > 0) warnings.push(`${skipped} malformed PATH prediction(s) skipped.`);
  return {
    stationId,
    stationName: PATH_STATIONS[code]!,
    arrivals: trim(arrivals, now),
    generatedAt: now,
    // Each PATH prediction has its own lastUpdated, but it only changes when that train's
    // estimate does: live checks showed values ~110 s old at quiet stations while others were
    // seconds old. So it cannot tell "frozen feed" from "nothing changed"; fetch time is used.
    dataAsOf: feed.fetchedAt,
    stale: feed.stale,
    unavailableRoutes: [],
    warnings,
  };
}

async function buildSubwayBoard(
  stationId: string,
  complexId: string,
  deps: BoardDeps,
): Promise<Board | null> {
  const complex = getComplex(complexId);
  if (!complex) return null;

  // Every feed is consulted, not just the ones for the station's daytime routes: at night
  // other lines run local (e.g. the D along 4 Av), and each feed fetch is shared via the cache.
  // Freshness and failures are only reported for the feeds that serve the station's routes,
  // so a Staten Island Railway outage does not put a warning on the Times Sq board.
  const relevant = new Set(complex.routes.flatMap((r) => feedsForRoute(r)));
  const results = await Promise.allSettled(MTA_FEEDS.map((f) => deps.getMtaFeed(f)));
  const now = deps.now();

  const arrivals: Arrival[] = [];
  const warnings: string[] = [];
  const failed = new Set<MtaFeed>();
  const asOf: number[] = [];
  let stale = false;

  results.forEach((result, i) => {
    const feed = MTA_FEEDS[i]!;
    const label = feedLabel(feed);
    if (result.status === "rejected") {
      if (relevant.has(feed)) {
        failed.add(feed);
        warnings.push(`${label} feed unavailable.`);
      }
      return;
    }
    const { value, fetchedAt, stale: servedStale } = result.value;
    arrivals.push(...subwayArrivals(value, complex, now));
    if (!relevant.has(feed)) return;

    const generated = Math.min(feedTimestamp(value) ?? fetchedAt, fetchedAt);
    asOf.push(generated);
    if (servedStale) {
      stale = true;
      warnings.push(`${label} feed refresh failed; showing cached data.`);
    } else if (now - generated > FROZEN_FEED_MS) {
      stale = true;
      const minutes = Math.floor((now - generated) / 60_000);
      warnings.push(`${label} feed has not updated for ${minutes} min.`);
    }
  });

  if (asOf.length === 0) {
    throw new BoardUnavailableError(`No live data for ${complex.name}: its MTA feeds are down.`);
  }

  return {
    stationId,
    stationName: complex.name,
    arrivals: trim(arrivals, now),
    generatedAt: now,
    dataAsOf: Math.min(...asOf),
    stale,
    unavailableRoutes: complex.routes.filter((r) => feedsForRoute(r).some((f) => failed.has(f))),
    warnings,
  };
}

/**
 * Builds the arrivals board for "path-<CODE>" or "subway-<complexId>".
 * Returns null for an unknown station id. Dependencies are injected so tests can run
 * against recorded fixtures without network access.
 */
export async function buildBoard(stationId: string, deps: BoardDeps): Promise<Board | null> {
  const [system, key = ""] = stationId.split(/-(.*)/s);
  if (system === "path" && Object.hasOwn(PATH_STATIONS, key)) {
    return buildPathBoard(stationId, key, deps);
  }
  if (system === "subway") return buildSubwayBoard(stationId, key, deps);
  return null;
}
