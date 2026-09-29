import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBoard, BoardUnavailableError, type BoardDeps } from "@/lib/board";
import { decodeFeed, feedTimestamp, subwayArrivals } from "@/lib/mta";
import { readPathFeed } from "@/lib/path";
import { BoardSchema } from "@/lib/schema";
import { getComplex, SUBWAY_COMPLEXES } from "@/lib/subway-data";
import type { MtaFeed } from "@/lib/upstream";
import { syntheticFeed, type SyntheticTrip } from "./synthetic-feed";

const pathFeed = readPathFeed(
  JSON.parse(readFileSync(new URL("./fixtures/ridepath.json", import.meta.url), "utf8")),
);
const lFeed = decodeFeed(readFileSync(new URL("./fixtures/nyct-gtfs-l.pb", import.meta.url)));
const aceFeed = decodeFeed(readFileSync(new URL("./fixtures/nyct-gtfs-ace.pb", import.meta.url)));
const NOW = feedTimestamp(lFeed)!;
type Feed = typeof lFeed;

/** Board deps backed by recorded feeds; any feed not in `feeds` fails like an outage. */
function deps(
  feeds: Partial<Record<MtaFeed, Feed>> = { "-l": lFeed, "-ace": aceFeed },
  overrides: Partial<BoardDeps> = {},
): BoardDeps {
  return {
    now: () => NOW,
    getPathFeed: async () => ({ value: pathFeed, fetchedAt: NOW, stale: false }),
    getMtaFeed: async (feed) => {
      const value = feeds[feed];
      if (!value) throw new Error("not recorded");
      return { value, fetchedAt: NOW + 2_000, stale: false };
    },
    ...overrides,
  };
}

const L_ONLY = SUBWAY_COMPLEXES.find((c) => c.routes.join() === "L")!;

describe("buildBoard (PATH)", () => {
  it("builds a schema-valid PATH board", async () => {
    const board = await buildBoard("path-HOB", deps());
    expect(BoardSchema.parse(board)).toEqual(board);
    expect(board).toMatchObject({
      stationName: "Hoboken",
      stale: false,
      unavailableRoutes: [],
      warnings: [],
      dataAsOf: NOW,
    });
    expect(board!.arrivals.length).toBeGreaterThan(0);
  });

  it("marks the board stale when served from cache after an upstream error", async () => {
    const board = await buildBoard(
      "path-HOB",
      deps(undefined, {
        getPathFeed: async () => ({
          value: pathFeed,
          fetchedAt: NOW - 90_000,
          stale: true,
          error: "www.panynj.gov timed out",
        }),
      }),
    );
    expect(board!.stale).toBe(true);
    expect(board!.warnings[0]).toMatch(/timed out/);
  });
});

describe("buildBoard (subway)", () => {
  it("merges feeds and names the station's routes whose feed is down", async () => {
    const board = (await buildBoard("subway-602", deps()))!;
    expect(BoardSchema.safeParse(board).success).toBe(true);
    expect(board.stationName).toBe("14 St-Union Sq");
    expect(new Set(board.arrivals.map((a) => a.route))).toEqual(new Set(["L"]));
    // Union Sq is served by the 1-7, L and N/Q/R/W feeds; only the L one was recorded.
    expect(board.unavailableRoutes).toEqual(getComplex("602")!.routes.filter((r) => r !== "L"));
    expect(board.warnings.sort()).toEqual(["1-7/S feed unavailable.", "NQRW feed unavailable."]);
    // dataAsOf is the feed's own header timestamp, not the (later) time we fetched it.
    expect(board.dataAsOf).toBe(NOW);
    expect(board.stale).toBe(false);
  });

  it("keeps every line at a multi-line hub instead of letting frequent lines crowd it out", async () => {
    // Synthetic 1/2/3 and N/Q/R/W trains every 20 s from now in both directions: under a
    // per-direction cap they would fill all "Uptown"/"Downtown" slots before any A/C/E.
    const t0 = Math.floor(NOW / 1000);
    const trips = (routes: string[], stop: string, north: string, south: string) =>
      routes.flatMap((routeId, r) =>
        Array.from({ length: 10 }, (_, i): SyntheticTrip[] => {
          const at = t0 + (i * routes.length + r) * 20;
          return [
            {
              routeId,
              stops: [
                [`${stop}N`, at],
                [`${north}N`, at + 1800],
              ],
            },
            {
              routeId,
              stops: [
                [`${stop}S`, at],
                [`${south}S`, at + 1800],
              ],
            },
          ];
        }).flat(),
      );
    const feeds = {
      "": syntheticFeed(trips(["1", "2", "3"], "127", "101", "142"), t0),
      "-nqrw": syntheticFeed(trips(["N", "Q", "R", "W"], "R16", "R01", "D43"), t0),
      "-ace": aceFeed,
    };
    const complex = getComplex("611")!;
    const expectedRoutes = new Set(
      Object.values(feeds).flatMap((f) =>
        subwayArrivals(f, complex, NOW)
          .filter((a) => a.arrivalTime <= NOW + 60 * 60_000)
          .map((a) => a.route),
      ),
    );
    expect(expectedRoutes).toContain("A");

    const board = (await buildBoard("subway-611", deps(feeds)))!;
    expect(new Set(board.arrivals.map((a) => a.route))).toEqual(expectedRoutes);

    const perRoute = new Map<string, number>();
    for (const a of board.arrivals) {
      const key = `${a.direction}/${a.route}`;
      perRoute.set(key, (perRoute.get(key) ?? 0) + 1);
      expect(a.arrivalTime).toBeLessThanOrEqual(NOW + 60 * 60_000);
    }
    expect(Math.max(...perRoute.values())).toBe(3);
    const times = board.arrivals.map((a) => a.arrivalTime);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("does not warn about feeds that do not serve the station", async () => {
    const board = (await buildBoard(`subway-${L_ONLY.id}`, deps({ "-l": lFeed })))!;
    expect(board.warnings).toEqual([]);
    expect(board.unavailableRoutes).toEqual([]);
  });

  it("returns 503-style unavailability when every feed serving the station is down", async () => {
    await expect(buildBoard(`subway-${L_ONLY.id}`, deps({ "-ace": aceFeed }))).rejects.toThrow(
      BoardUnavailableError,
    );
  });

  it("marks a board stale when a feed's own timestamp stops advancing", async () => {
    const board = (await buildBoard(
      `subway-${L_ONLY.id}`,
      deps({ "-l": lFeed }, { now: () => NOW + 3 * 60_000 }),
    ))!;
    expect(board.stale).toBe(true);
    expect(board.warnings).toEqual(["L feed has not updated for 3 min."]);
    expect(board.dataAsOf).toBe(NOW);
    expect(board.generatedAt).toBe(NOW + 3 * 60_000);
  });
});

describe("buildBoard (errors and ids)", () => {
  it("throws BoardUnavailableError when no data at all is available", async () => {
    const failing = deps(
      {},
      {
        getPathFeed: async () => {
          throw new Error("down");
        },
      },
    );
    await expect(buildBoard("path-HOB", failing)).rejects.toBeInstanceOf(BoardUnavailableError);
    await expect(buildBoard("subway-602", failing)).rejects.toBeInstanceOf(BoardUnavailableError);
  });

  it.each(["path-XYZ", "path-toString", "subway-999999", "bus-1", "path", ""])(
    "returns null for unknown station id %j",
    async (id) => {
      expect(await buildBoard(id, deps())).toBeNull();
    },
  );
});
