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

/** Lowercase letters and digits only: "HOB-33" -> "hob33", "JSQ" -> "jsq". */
function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Whole-word search keys besides the name: route labels ("a", "7", "hob33") and, for PATH,
 * the station code riders see on signs and timetables ("jsq", "wtc", "33s").
 */
function keywordsOf(station: Station): Set<string> {
  const keys = station.routes.map(compact);
  if (station.system === "PATH") keys.push(compact(station.id.slice("path-".length)));
  return new Set(keys);
}

/**
 * Ranks stations for the search box. Each whitespace-separated query word must either be a
 * route or PATH-code keyword ("a", "hob-33", "jsq") or have every piece match the start of a
 * word in the station name ("14th", "sq-42"). Prefix-of-name matches rank first so typing
 * "hob" puts Hoboken above "Hoyt-Schermerhorn".
 */
export function searchStations(query: string, stations = ALL_STATIONS, limit = 8): Station[] {
  const words = query.split(/\s+/).filter((w) => compact(w) !== "");
  if (words.length === 0) return [];
  const fullQuery = normalize(query);

  const scored: { station: Station; score: number }[] = [];
  for (const station of stations) {
    const nameNorm = normalize(station.name);
    const nameTokens = nameNorm.split(" ");
    const keywords = keywordsOf(station);
    const byKeyword = (w: string) => keywords.has(compact(w));
    const byName = (w: string) =>
      normalize(w)
        .split(" ")
        .every((piece) => nameTokens.some((n) => n.startsWith(piece)));
    if (!words.every((w) => byKeyword(w) || byName(w))) continue;
    const score = nameNorm.startsWith(fullQuery) ? 0 : words.some(byKeyword) ? 2 : 1;
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
