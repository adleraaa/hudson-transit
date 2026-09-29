import { describe, expect, it } from "vitest";
import { buildSubwayData } from "../scripts/build-stations";
import { parseCsv } from "../scripts/csv";

describe("parseCsv", () => {
  it("handles BOM, quotes, escaped quotes, embedded commas and CRLF", () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,,z\r\n';
    expect(parseCsv(text)).toEqual([
      { a: "1", b: "x, y", c: 'say "hi"' },
      { a: "2", b: "", c: "z" },
    ]);
  });

  it("handles a missing trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });
});

describe("buildSubwayData", () => {
  const stops = [
    "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
    "127,Times Sq-42 St,0,0,1,",
    "127N,Times Sq-42 St,0,0,,127",
    "A27,42 St-Port Authority Bus Terminal,0,0,1,",
    "L29,Canarsie-Rockaway Pkwy,0,0,1,",
  ].join("\n");
  const routes = ["route_id,route_short_name,route_color", "GS,S,7C858C", "A,A,0062CF"].join("\n");
  const stations = [
    "GTFS Stop ID,Complex ID,Stop Name,Borough,Daytime Routes,North Direction Label,South Direction Label",
    "127,611,Times Sq-42 St,M,1 2 3,Uptown,Downtown",
    'A27,611,"42 St-Port Authority Bus Terminal",M,A C E,Uptown,Downtown',
    "L29,120,Canarsie-Rockaway Pkwy,Bk,L,Manhattan,",
  ].join("\n");

  const data = buildSubwayData(stops, routes, stations, "2026-01-01T00:00:00Z");

  it("groups stops into transfer complexes and merges routes and names", () => {
    const times = data.complexes.find((c) => c.id === "611")!;
    expect(times.name).toBe("Times Sq-42 St / 42 St-Port Authority Bus Terminal");
    expect(times.routes).toEqual(["1", "2", "3", "A", "C", "E"]);
    expect(times.stops.map((s) => s.id)).toEqual(["127", "A27"]);
    expect(times.borough).toBe("Manhattan");
  });

  it("fills empty direction labels at terminals", () => {
    const canarsie = data.complexes.find((c) => c.id === "120")!;
    expect(canarsie.stops[0]).toMatchObject({ north: "Manhattan", south: "Southbound" });
  });

  it("keys route colors by GTFS route_id with the rider-facing label", () => {
    expect(data.routes.GS).toEqual({ label: "S", color: "7C858C" });
  });
});
