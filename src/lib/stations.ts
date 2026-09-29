import { PATH_STATIONS } from "./path";
import type { Station } from "./schema";
import { SUBWAY_COMPLEXES } from "./subway-data";

const PATH_ROUTES_AT: Record<string, string[]> = {
  NWK: ["NWK-WTC"],
  HAR: ["NWK-WTC"],
  JSQ: ["NWK-WTC", "JSQ-33"],
  GRV: ["NWK-WTC", "JSQ-33"],
  NEW: ["HOB-WTC", "JSQ-33"],
  EXP: ["NWK-WTC", "HOB-WTC"],
  HOB: ["HOB-WTC", "HOB-33"],
  WTC: ["NWK-WTC", "HOB-WTC"],
};

export const ALL_STATIONS: Station[] = [
  ...Object.entries(PATH_STATIONS).map(([code, name]) => ({
    id: `path-${code}`,
    system: "PATH" as const,
    name,
    routes: PATH_ROUTES_AT[code] ?? ["JSQ-33", "HOB-33"],
  })),
  ...SUBWAY_COMPLEXES.map((c) => ({
    id: `subway-${c.id}`,
    system: "SUBWAY" as const,
    name: c.name,
    routes: c.routes,
    borough: c.borough,
  })),
];

export const DEFAULT_STATION_ID = "path-HOB";

const byId = new Map(ALL_STATIONS.map((s) => [s.id, s]));
export function getStation(id: string): Station | undefined {
  return byId.get(id);
}

/**
 * Normalizes names so "14th Street", "14 St" and "14 st." all compare equal.
 * PATH spells names out ("Street") while MTA abbreviates ("St", "Av", "Sq").
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/\bstreet\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "av")
    .replace(/\bsquare\b/g, "sq")
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

/**
 * Ranks stations for the search box. Every query word must match either the start of a
 * word in the station name or one of its routes ("a", "7", "hob-33"). Prefix-of-name
 * matches rank first so typing "hob" puts Hoboken above "Hoyt-Schermerhorn".
 */
export function searchStations(query: string, stations = ALL_STATIONS, limit = 8): Station[] {
  const q = tokens(query);
  if (q.length === 0) return [];
  const fullQuery = q.join(" ");

  const scored: { station: Station; score: number }[] = [];
  for (const station of stations) {
    const nameNorm = normalize(station.name);
    const nameTokens = nameNorm.split(" ");
    const routeTokens = station.routes.map((r) => normalize(r));
    const allMatch = q.every(
      (t) => nameTokens.some((n) => n.startsWith(t)) || routeTokens.includes(t),
    );
    if (!allMatch) continue;
    const score = nameNorm.startsWith(fullQuery)
      ? 0
      : q.some((t) => routeTokens.includes(t))
        ? 2
        : 1;
    scored.push({ station, score });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      // PATH first on ties: this board is aimed at Hudson River commuters.
      Number(b.station.system === "PATH") - Number(a.station.system === "PATH") ||
      a.station.name.localeCompare(b.station.name),
  );
  return scored.slice(0, limit).map((s) => s.station);
}
