/**
 * Builds data/subway-stations.json from two official MTA sources:
 *
 * 1. MTA static subway GTFS (stops.txt for stop names, routes.txt for route colors)
 *    https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip
 * 2. "MTA Subway Stations" on NY Open Data, which adds what GTFS lacks: which stops form
 *    one transfer complex, and the rider-facing labels for the N/S directions
 *    ("Uptown", "Manhattan", ...). https://data.ny.gov/d/39hk-dx4f
 *
 * Usage: npm run stations
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { parseCsv } from "./csv";

const GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip";
const STATIONS_URL = "https://data.ny.gov/api/views/39hk-dx4f/rows.csv?accessType=DOWNLOAD";
const OUT = new URL("../data/subway-stations.json", import.meta.url);

const BOROUGHS: Record<string, string> = {
  M: "Manhattan",
  Bk: "Brooklyn",
  Bx: "Bronx",
  Q: "Queens",
  SI: "Staten Island",
};

export type SubwayStop = { id: string; name: string; north: string; south: string };
export type SubwayComplex = {
  id: string;
  name: string;
  borough: string;
  routes: string[];
  stops: SubwayStop[];
};
export type SubwayRoute = { label: string; color: string };
export type SubwayData = {
  source: { gtfs: string; stations: string; generatedAt: string };
  routes: Record<string, SubwayRoute>;
  complexes: SubwayComplex[];
};

export function buildSubwayData(
  stopsCsv: string,
  routesCsv: string,
  stationsCsv: string,
  generatedAt: string,
): SubwayData {
  // Parent stations only (location_type=1); realtime feeds use child ids like "127N".
  const stopNames = new Map<string, string>();
  for (const s of parseCsv(stopsCsv)) {
    if (s.location_type === "1") stopNames.set(s.stop_id!, s.stop_name!);
  }

  const routes: Record<string, SubwayRoute> = {};
  for (const r of parseCsv(routesCsv)) {
    routes[r.route_id!] = {
      label: r.route_short_name || r.route_id!,
      color: r.route_color || "808183",
    };
  }

  const byComplex = new Map<string, SubwayComplex>();
  for (const row of parseCsv(stationsCsv)) {
    const stopId = row["GTFS Stop ID"]!;
    const complexId = row["Complex ID"]!;
    const name = stopNames.get(stopId) ?? row["Stop Name"]!;
    const stop: SubwayStop = {
      id: stopId,
      name,
      // Terminal stations have an empty label for the direction trains never run in.
      north: row["North Direction Label"] || "Northbound",
      south: row["South Direction Label"] || "Southbound",
    };
    const dayRoutes = (row["Daytime Routes"] ?? "").split(/\s+/).filter(Boolean);

    const existing = byComplex.get(complexId);
    if (existing) {
      existing.stops.push(stop);
      for (const r of dayRoutes) if (!existing.routes.includes(r)) existing.routes.push(r);
    } else {
      byComplex.set(complexId, {
        id: complexId,
        name,
        borough: BOROUGHS[row.Borough!] ?? row.Borough!,
        routes: dayRoutes,
        stops: [stop],
      });
    }
  }

  const complexes = [...byComplex.values()].map((c) => ({
    ...c,
    // A complex like Times Sq includes "42 St-Port Authority Bus Terminal"; show both names.
    name: [...new Set(c.stops.map((s) => s.name))].join(" / "),
    stops: c.stops.sort((a, b) => a.id.localeCompare(b.id)),
  }));
  complexes.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return { source: { gtfs: GTFS_URL, stations: STATIONS_URL, generatedAt }, routes, complexes };
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const zip = unzipSync(await fetchBytes(GTFS_URL), {
    filter: (f) => f.name === "stops.txt" || f.name === "routes.txt",
  });
  const stationsCsv = strFromU8(await fetchBytes(STATIONS_URL));
  const data = buildSubwayData(
    strFromU8(zip["stops.txt"]!),
    strFromU8(zip["routes.txt"]!),
    stationsCsv,
    new Date().toISOString(),
  );
  await writeFile(OUT, JSON.stringify(data) + "\n");
  const stopCount = data.complexes.reduce((n, c) => n + c.stops.length, 0);
  console.log(`wrote ${data.complexes.length} complexes / ${stopCount} stops to ${OUT.pathname}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
