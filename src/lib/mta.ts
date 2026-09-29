// Default import on purpose: the bindings are CommonJS (`module.exports = $root`), so
// Node's ESM loader cannot see named exports. Types are imported separately.
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import type { transit_realtime } from "gtfs-realtime-bindings";
import type { Arrival } from "./schema";
import { getStop, SUBWAY_ROUTES, type SubwayComplex } from "./subway-data";

type FeedMessage = transit_realtime.FeedMessage;
type LongLike = number | { toNumber(): number } | null | undefined;

export function decodeFeed(bytes: Uint8Array): FeedMessage {
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
}

/** protobufjs returns uint64/int64 fields as Long objects when the `long` package is present. */
export function toNumber(value: LongLike): number | undefined {
  if (value == null) return undefined;
  return typeof value === "number" ? value : value.toNumber();
}

/** Header timestamp of a feed in epoch ms (GTFS-rt uses POSIX seconds, always UTC). */
export function feedTimestamp(feed: FeedMessage): number | undefined {
  const seconds = toNumber(feed.header.timestamp as LongLike);
  return seconds ? seconds * 1000 : undefined;
}

/** A train that left up to this long ago may still be in the feed; hide it. */
const DEPARTED_GRACE_MS = 30_000;

/**
 * Returns the upcoming trains that stop at any platform of `complex`.
 *
 * Direction comes from the platform suffix (N/S) mapped to the MTA's rider-facing label,
 * and the destination is the trip's last *known* stop: the feeds also list non-revenue
 * timing points (e.g. "A58S", "H19N") that are not in the static GTFS, and a rider should
 * never see those ids. Trains that terminate at this station are dropped: you cannot
 * board them, so showing them is just noise.
 */
export function subwayArrivals(feed: FeedMessage, complex: SubwayComplex, now: number): Arrival[] {
  const platformIds = new Set(complex.stops.flatMap((s) => [`${s.id}N`, `${s.id}S`]));
  const arrivals: Arrival[] = [];

  for (const entity of feed.entity) {
    const update = entity.tripUpdate;
    const stus = update?.stopTimeUpdate;
    if (!update || !stus?.length) continue;

    const terminalIndex = stus.findLastIndex((stu) => stu.stopId && getStop(stu.stopId));
    if (terminalIndex < 0) continue;
    const terminal = getStop(stus[terminalIndex]!.stopId!)!;
    const routeId = update.trip.routeId ?? "";
    const route = SUBWAY_ROUTES[routeId];

    // Stops at or after the terminal are excluded, which also drops "terminates here".
    for (const stu of stus.slice(0, terminalIndex)) {
      if (!stu.stopId || !platformIds.has(stu.stopId)) continue;
      const stop = getStop(stu.stopId)!;

      const seconds =
        toNumber(stu.arrival?.time as LongLike) ?? toNumber(stu.departure?.time as LongLike);
      if (!seconds) continue;
      const arrivalTime = seconds * 1000;
      if (arrivalTime < now - DEPARTED_GRACE_MS) continue;

      arrivals.push({
        system: "SUBWAY",
        route: route?.label ?? (routeId || "?"),
        routeColor: route?.color ?? "808183",
        direction: stu.stopId.endsWith("N") ? stop.north : stop.south,
        destination: terminal.name,
        arrivalTime,
        tripId: update.trip.tripId ?? undefined,
      });
    }
  }

  return arrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
}
