import type { transit_realtime } from "gtfs-realtime-bindings";
import type { CacheResult } from "./feed-cache";
import { subwayArrivals } from "./mta";
import { parsePathFeed, PATH_STATIONS } from "./path";
import type { Arrival, Board } from "./schema";
import { getComplex } from "./subway-data";
import { MTA_FEEDS, type MtaFeed } from "./upstream";

export type BoardDeps = {
  getPathFeed: () => Promise<CacheResult<unknown>>;
  getMtaFeed: (feed: MtaFeed) => Promise<CacheResult<transit_realtime.FeedMessage>>;
  now: () => number;
};

/** Thrown when no upstream data (fresh or stale) is available for a station. */
export class BoardUnavailableError extends Error {}

const HORIZON_MS = 60 * 60_000;
const MAX_PER_DIRECTION = 6;
const DEPARTED_GRACE_MS = 30_000;

function feedLabel(feed: MtaFeed): string {
  return feed === "" ? "1-7/S" : feed.slice(1).toUpperCase();
}

/** Keeps the next hour of trains, at most MAX_PER_DIRECTION per direction. */
function trim(arrivals: Arrival[], now: number): Arrival[] {
  const perDirection = new Map<string, number>();
  return arrivals
    .filter((a) => a.arrivalTime >= now - DEPARTED_GRACE_MS && a.arrivalTime <= now + HORIZON_MS)
    .sort((a, b) => a.arrivalTime - b.arrivalTime)
    .filter((a) => {
      const n = perDirection.get(a.direction) ?? 0;
      perDirection.set(a.direction, n + 1);
      return n < MAX_PER_DIRECTION;
    });
}

/**
 * Builds the arrivals board for "path-<CODE>" or "subway-<complexId>".
 * Returns null for an unknown station id. Dependencies are injected so tests can run
 * against recorded fixtures without network access.
 */
export async function buildBoard(stationId: string, deps: BoardDeps): Promise<Board | null> {
  const [system, key = ""] = stationId.split(/-(.*)/s);
  const now = deps.now();

  if (system === "path" && Object.hasOwn(PATH_STATIONS, key)) {
    let feed: CacheResult<unknown>;
    try {
      feed = await deps.getPathFeed();
    } catch (err) {
      throw new BoardUnavailableError(`PATH data unavailable: ${(err as Error).message}`);
    }
    const { arrivals, skipped } = parsePathFeed(feed.value, key);
    const warnings: string[] = [];
    if (feed.stale) warnings.push(`PATH feed refresh failed (${feed.error}); showing cached data.`);
    if (skipped > 0) warnings.push(`${skipped} malformed PATH prediction(s) skipped.`);
    return {
      stationId,
      stationName: PATH_STATIONS[key]!,
      arrivals: trim(arrivals, now),
      generatedAt: now,
      dataAsOf: feed.fetchedAt,
      stale: feed.stale,
      warnings,
    };
  }

  const complex = system === "subway" ? getComplex(key) : undefined;
  if (!complex) return null;

  // Every feed is consulted, not just the ones for the station's daytime routes: at night
  // other lines run local (e.g. the D along 4 Av), and each feed fetch is shared via the cache.
  const results = await Promise.allSettled(MTA_FEEDS.map((f) => deps.getMtaFeed(f)));
  const arrivals: Arrival[] = [];
  const warnings: string[] = [];
  const fetchedAts: number[] = [];
  let stale = false;

  results.forEach((result, i) => {
    const label = feedLabel(MTA_FEEDS[i]!);
    if (result.status === "rejected") {
      warnings.push(`${label} feed unavailable.`);
      return;
    }
    if (result.value.stale) {
      stale = true;
      warnings.push(`${label} feed refresh failed; showing cached data.`);
    }
    fetchedAts.push(result.value.fetchedAt);
    arrivals.push(...subwayArrivals(result.value.value, complex, now));
  });

  if (fetchedAts.length === 0) throw new BoardUnavailableError("All MTA feeds are unavailable.");

  return {
    stationId,
    stationName: complex.name,
    arrivals: trim(arrivals, now),
    generatedAt: now,
    dataAsOf: Math.min(...fetchedAts),
    stale,
    warnings,
  };
}
