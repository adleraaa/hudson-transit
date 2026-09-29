import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { decodeFeed } from "@/lib/mta";

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

export type SyntheticTrip = { routeId: string; stops: [stopId: string, epochSeconds: number][] };

/** Builds a feed through protobuf encode/decode so times come back as Long, like production. */
export function syntheticFeed(trips: SyntheticTrip[], headerSeconds = 1_790_000_000) {
  const message = FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: "1.0", timestamp: headerSeconds },
    entity: trips.map((t, i) => ({
      id: String(i),
      tripUpdate: {
        trip: { tripId: `trip-${i}`, routeId: t.routeId },
        stopTimeUpdate: t.stops.map(([stopId, time]) => ({ stopId, arrival: { time } })),
      },
    })),
  });
  return decodeFeed(FeedMessage.encode(message).finish());
}
