/** Upstream endpoints and a fetch helper with a hard timeout. No API keys are required. */

export const PATH_URL = "https://www.panynj.gov/bin/portauthority/ridepath.json";

/** Suffixes of the eight NYC Subway GTFS-realtime feeds ("" is the 1-7 + S feed). */
export const MTA_FEEDS = ["", "-ace", "-bdfm", "-g", "-jz", "-nqrw", "-l", "-si"] as const;
export type MtaFeed = (typeof MTA_FEEDS)[number];

/**
 * The feed(s) that carry each rider-facing route label used in data/subway-stations.json.
 * "S" is ambiguous: the 42 St shuttle is in the 1-7 feed, the Rockaway Park shuttle (H) in
 * A/C/E and the Franklin Av shuttle in B/D/F/M.
 */
const FEEDS_BY_ROUTE: Record<string, readonly MtaFeed[]> = {
  ...Object.fromEntries(["1", "2", "3", "4", "5", "6", "7"].map((r) => [r, [""]])),
  ...Object.fromEntries(["A", "C", "E"].map((r) => [r, ["-ace"]])),
  ...Object.fromEntries(["B", "D", "F", "M"].map((r) => [r, ["-bdfm"]])),
  ...Object.fromEntries(["N", "Q", "R", "W"].map((r) => [r, ["-nqrw"]])),
  ...Object.fromEntries(["J", "Z"].map((r) => [r, ["-jz"]])),
  G: ["-g"],
  L: ["-l"],
  SIR: ["-si"],
  S: ["", "-ace", "-bdfm"],
};

export function feedsForRoute(route: string): readonly MtaFeed[] {
  return FEEDS_BY_ROUTE[route] ?? [];
}

export function mtaFeedUrl(feed: MtaFeed): string {
  return `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs${feed}`;
}

export class UpstreamError extends Error {}

/**
 * GET a URL and return the body bytes, failing after `timeoutMs`.
 * A slow upstream must not hold the whole board hostage: the caller falls
 * back to cached data instead of waiting on a hung socket.
 */
export async function fetchBytes(url: string, timeoutMs = 6_000): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      // Our own TTL cache (feed-cache.ts) decides freshness; skip Next's data cache.
      cache: "no-store",
      headers: { "user-agent": "hudson-transit (+https://github.com/adleraaa/hudson-transit)" },
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "failed";
    throw new UpstreamError(`${new URL(url).hostname} ${reason}`);
  }
  if (!res.ok) throw new UpstreamError(`${new URL(url).hostname} returned HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
