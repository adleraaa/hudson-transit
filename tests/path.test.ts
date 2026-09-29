import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePathFeed, parsePathTimestamp, PATH_STATIONS, readPathFeed } from "@/lib/path";
import { ArrivalSchema } from "@/lib/schema";

const rawFixture: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/ridepath.json", import.meta.url), "utf8"),
);
const fixture = readPathFeed(rawFixture);

function feedWith(messages: unknown[], label = "ToNY") {
  return {
    results: [{ consideredStation: "HOB", destinations: [{ label, messages }] }],
  };
}

const goodMessage = {
  target: "WTC",
  secondsToArrival: "120",
  arrivalTimeMessage: "2 min",
  lineColor: "65C100",
  headSign: "World Trade Center",
  lastUpdated: "2026-09-28T20:15:06.504842-04:00",
};

describe("parsePathTimestamp", () => {
  it("keeps the UTC offset and truncates microseconds", () => {
    expect(parsePathTimestamp("2026-09-28T20:15:06.504842-04:00")).toBe(
      Date.UTC(2026, 8, 29, 0, 15, 6, 504),
    );
  });

  it("pads short fractions and handles EST offsets", () => {
    expect(parsePathTimestamp("2026-01-15T08:00:00.5-05:00")).toBe(
      Date.UTC(2026, 0, 15, 13, 0, 0, 500),
    );
    expect(parsePathTimestamp("2026-01-15T08:00:00-05:00")).toBe(Date.UTC(2026, 0, 15, 13));
  });

  it("rejects garbage", () => {
    expect(() => parsePathTimestamp("yesterday")).toThrow(/bad PATH timestamp/);
  });
});

describe("parsePathFeed on the recorded snapshot", () => {
  it("returns Hoboken's trains sorted by time, all valid Arrivals", () => {
    const { arrivals, skipped } = parsePathFeed(fixture, "HOB");
    expect(skipped).toBe(0);
    expect(arrivals.length).toBeGreaterThan(0);
    for (const a of arrivals) {
      expect(ArrivalSchema.safeParse(a).success).toBe(true);
      expect(a.system).toBe("PATH");
      // Hoboken is a terminal: every train in the snapshot heads to New York.
      expect(a.direction).toBe("To New York");
      expect(["HOB-WTC", "HOB-33"]).toContain(a.route);
    }
    const times = arrivals.map((a) => a.arrivalTime);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("computes arrival as lastUpdated + secondsToArrival", () => {
    const raw = rawFixture as {
      results: {
        consideredStation: string;
        destinations: { messages: { secondsToArrival: string; lastUpdated: string }[] }[];
      }[];
    };
    const first = raw.results.find((r) => r.consideredStation === "WTC")!.destinations[0]!
      .messages[0]!;
    const expected = parsePathTimestamp(first.lastUpdated) + Number(first.secondsToArrival) * 1000;
    const { arrivals } = parsePathFeed(fixture, "WTC");
    expect(arrivals.map((a) => a.arrivalTime)).toContain(expected);
    expect(new Set(arrivals.map((a) => a.direction))).toEqual(new Set(["To New Jersey"]));
  });

  it("covers every station code in the snapshot", () => {
    for (const code of Object.keys(PATH_STATIONS)) {
      expect(parsePathFeed(fixture, code).skipped).toBe(0);
    }
  });

  it("returns nothing for a station that is not in the feed", () => {
    expect(parsePathFeed(fixture, "XYZ")).toEqual({ arrivals: [], skipped: 0 });
  });
});

describe("parsePathFeed edge cases", () => {
  it("skips a malformed prediction but keeps the rest", () => {
    const feed = feedWith([{ ...goodMessage, secondsToArrival: "soon" }, goodMessage]);
    const { arrivals, skipped } = parsePathFeed(feed, "HOB");
    expect(skipped).toBe(1);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({ route: "HOB-WTC", routeColor: "65C100" });
  });

  it("skips a prediction with an unparseable timestamp", () => {
    const feed = feedWith([{ ...goodMessage, lastUpdated: "n/a" }]);
    expect(parsePathFeed(feed, "HOB")).toEqual({ arrivals: [], skipped: 1 });
  });

  it("labels two-color late-night trains", () => {
    const feed = feedWith([{ ...goodMessage, lineColor: "FF9900,4D92FB" }]);
    expect(parsePathFeed(feed, "HOB").arrivals[0]).toMatchObject({
      route: "JSQ-33 via HOB",
      routeColor: "FF9900",
    });
  });

  it("falls back to a neutral route for an unknown or invalid color", () => {
    const feed = feedWith([
      { ...goodMessage, lineColor: "123456" },
      { ...goodMessage, lineColor: "" },
    ]);
    const routes = parsePathFeed(feed, "HOB").arrivals.map((a) => [a.route, a.routeColor]);
    expect(routes).toEqual([
      ["PATH", "123456"],
      ["PATH", "808183"],
    ]);
  });
});

describe("readPathFeed", () => {
  it("accepts the recorded snapshot", () => {
    expect(fixture.results).toHaveLength(13);
  });

  it.each([{ stations: [] }, { results: null }, "<html>maintenance</html>", null])(
    "rejects a body with the wrong top-level shape: %j",
    (body) => {
      expect(() => readPathFeed(body)).toThrow(/unexpected ridepath.json shape/);
    },
  );
});
