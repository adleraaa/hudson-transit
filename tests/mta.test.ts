import { readFileSync } from "node:fs";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";
import { decodeFeed, feedTimestamp, subwayArrivals, toNumber } from "@/lib/mta";
import { ArrivalSchema } from "@/lib/schema";
import { getComplex, SUBWAY_COMPLEXES } from "@/lib/subway-data";

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

function loadFixture(name: string) {
  const feed = decodeFeed(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
  return { feed, now: feedTimestamp(feed)! };
}

const UNION_SQ = getComplex("602")!; // 14 St-Union Sq: 4/5/6, L, N/Q/R/W
const TIMES_SQ = getComplex("611")!; // includes 42 St-Port Authority (A/C/E)

/** Builds a feed through protobuf encode/decode so times come back as Long, like production. */
function syntheticFeed(
  trips: { routeId: string; stops: [stopId: string, epochSeconds: number][] }[],
  headerSeconds = 1_790_000_000,
) {
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

describe("toNumber", () => {
  it("accepts numbers, Long-like objects and nullish values", () => {
    expect(toNumber(5)).toBe(5);
    expect(toNumber({ toNumber: () => 7 })).toBe(7);
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
  });
});

describe("subwayArrivals on recorded snapshots", () => {
  it("finds L trains at 14 St-Union Sq with MTA direction labels", () => {
    const { feed, now } = loadFixture("nyct-gtfs-l.pb");
    const arrivals = subwayArrivals(feed, UNION_SQ, now);
    expect(arrivals.length).toBeGreaterThan(0);
    for (const a of arrivals) {
      expect(ArrivalSchema.safeParse(a).success).toBe(true);
      expect(a.route).toBe("L");
      expect(["West Side", "Brooklyn"]).toContain(a.direction);
      expect(a.arrivalTime).toBeGreaterThanOrEqual(now - 30_000);
    }
    const times = arrivals.map((a) => a.arrivalTime);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("finds A/C/E trains at the Times Sq complex via its Port Authority platforms", () => {
    const { feed, now } = loadFixture("nyct-gtfs-ace.pb");
    const routes = new Set(subwayArrivals(feed, TIMES_SQ, now).map((a) => a.route));
    expect([...routes].every((r) => ["A", "C", "E"].includes(r))).toBe(true);
    expect(routes.size).toBeGreaterThan(0);
  });

  it("never shows a raw stop id as a destination, at any station", () => {
    // The A/C/E feed contains non-revenue timing points (e.g. H19N) missing from static GTFS.
    for (const fixture of ["nyct-gtfs-ace.pb", "nyct-gtfs-l.pb", "nyct-gtfs-si.pb"]) {
      const { feed, now } = loadFixture(fixture);
      for (const complex of SUBWAY_COMPLEXES) {
        for (const a of subwayArrivals(feed, complex, now)) {
          expect(a.destination).not.toMatch(/^[A-Z0-9]\d\d[NS]?$/);
        }
      }
    }
  });
});

describe("subwayArrivals rules (synthetic feeds)", () => {
  const now = 1_790_000_000_000;
  const t = (minutes: number) => now / 1000 + minutes * 60;

  it("maps N/S platforms to the station's direction labels and uses the terminal as destination", () => {
    const feed = syntheticFeed([
      {
        routeId: "L",
        stops: [
          ["L03N", t(2)],
          ["L01N", t(5)],
        ],
      },
      {
        routeId: "L",
        stops: [
          ["L03S", t(3)],
          ["L29S", t(40)],
        ],
      },
    ]);
    const arrivals = subwayArrivals(feed, UNION_SQ, now);
    expect(arrivals.map((a) => [a.direction, a.destination, a.tripId])).toEqual([
      ["West Side", "8 Av", "trip-0"],
      ["Brooklyn", "Canarsie-Rockaway Pkwy", "trip-1"],
    ]);
    expect(arrivals[0]!.arrivalTime).toBe(t(2) * 1000);
  });

  it("drops trains that terminate at the station", () => {
    const feed = syntheticFeed([
      {
        routeId: "L",
        stops: [
          ["L05N", t(1)],
          ["L03N", t(3)],
        ],
      },
    ]);
    expect(subwayArrivals(feed, UNION_SQ, now)).toEqual([]);
  });

  it("ignores trailing unknown timing points when picking the destination", () => {
    const feed = syntheticFeed([
      {
        routeId: "L",
        stops: [
          ["L03N", t(2)],
          ["L01N", t(5)],
          ["X99N", t(9)],
        ],
      },
      // Terminal known stop is this station, followed only by a timing point: drop it.
      {
        routeId: "L",
        stops: [
          ["L05N", t(1)],
          ["L03N", t(3)],
          ["X99N", t(9)],
        ],
      },
    ]);
    const arrivals = subwayArrivals(feed, UNION_SQ, now);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]!.destination).toBe("8 Av");
  });

  it("hides trains that already left but keeps ones within the 30 s grace window", () => {
    const feed = syntheticFeed([
      {
        routeId: "L",
        stops: [
          ["L03N", now / 1000 - 120],
          ["L01N", t(3)],
        ],
      },
      {
        routeId: "L",
        stops: [
          ["L03N", now / 1000 - 20],
          ["L01N", t(3)],
        ],
      },
    ]);
    expect(subwayArrivals(feed, UNION_SQ, now).map((a) => a.tripId)).toEqual(["trip-1"]);
  });

  it("uses the static GTFS route color and falls back for unknown routes", () => {
    const feed = syntheticFeed([
      {
        routeId: "6X",
        stops: [
          ["635S", t(4)],
          ["640S", t(10)],
        ],
      },
      {
        routeId: "ZZ",
        stops: [
          ["635S", t(5)],
          ["640S", t(11)],
        ],
      },
    ]);
    const arrivals = subwayArrivals(feed, UNION_SQ, now);
    expect(arrivals.map((a) => [a.route, a.routeColor])).toEqual([
      ["6X", "009952"],
      ["ZZ", "808183"],
    ]);
  });
});
