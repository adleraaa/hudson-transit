import { z } from "zod";
import type { Arrival } from "./schema";

/** The 13 PATH stations, keyed by the codes used in ridepath.json. */
export const PATH_STATIONS: Record<string, string> = {
  NWK: "Newark",
  HAR: "Harrison",
  JSQ: "Journal Square",
  GRV: "Grove Street",
  NEW: "Newport",
  EXP: "Exchange Place",
  HOB: "Hoboken",
  WTC: "World Trade Center",
  CHR: "Christopher Street",
  "09S": "9th Street",
  "14S": "14th Street",
  "23S": "23rd Street",
  "33S": "33rd Street",
};

/** PATH identifies lines only by color; these are the four published line colors. */
const PATH_LINES: Record<string, string> = {
  D93A30: "NWK-WTC",
  FF9900: "JSQ-33",
  "65C100": "HOB-WTC",
  "4D92FB": "HOB-33",
};

const DIRECTIONS: Record<string, string> = {
  ToNY: "To New York",
  ToNJ: "To New Jersey",
};

// Only the fields we use; unknown extra fields are ignored so a harmless upstream
// addition does not break the board.
const RawMessage = z.object({
  target: z.string(),
  secondsToArrival: z.coerce.number().int().nonnegative(),
  lineColor: z.string(),
  headSign: z.string().min(1),
  lastUpdated: z.string(),
});
const RawPathFeed = z.object({
  results: z.array(
    z.object({
      consideredStation: z.string(),
      destinations: z.array(z.object({ label: z.string(), messages: z.array(z.unknown()) })),
    }),
  ),
});

/**
 * ridepath.json timestamps look like "2026-09-28T20:15:06.504842-04:00". ECMAScript only
 * guarantees parsing of exactly 3 fractional digits, so trim/pad before Date.parse.
 * The explicit offset is kept, which is what makes this correct across DST changes.
 */
export function parsePathTimestamp(value: string): number {
  const normalized = value.replace(
    /\.(\d+)/,
    (_, frac: string) => "." + frac.padEnd(3, "0").slice(0, 3),
  );
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) throw new Error(`bad PATH timestamp: ${value}`);
  return ms;
}

function describeLine(lineColor: string): { route: string; routeColor: string } {
  // Late-night JSQ-33 via Hoboken trains carry two colors, e.g. "FF9900,4D92FB".
  const colors = lineColor
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[0-9A-F]{6}$/.test(c));
  const first = colors[0];
  if (!first) return { route: "PATH", routeColor: "808183" };
  if (colors.length > 1 && colors.includes("FF9900") && colors.includes("4D92FB")) {
    return { route: "JSQ-33 via HOB", routeColor: first };
  }
  return { route: PATH_LINES[first] ?? "PATH", routeColor: first };
}

export type ParseResult = { arrivals: Arrival[]; skipped: number };

/**
 * Extracts upcoming trains for one PATH station from the raw ridepath.json body.
 * Malformed individual predictions are skipped (and counted) instead of failing the
 * whole station, because one bad row should not blank out the board.
 */
export function parsePathFeed(raw: unknown, stationCode: string): ParseResult {
  const feed = RawPathFeed.parse(raw);
  const station = feed.results.find((r) => r.consideredStation === stationCode);
  if (!station) return { arrivals: [], skipped: 0 };

  const arrivals: Arrival[] = [];
  let skipped = 0;
  for (const dest of station.destinations) {
    const direction = DIRECTIONS[dest.label] ?? dest.label;
    for (const rawMsg of dest.messages) {
      const msg = RawMessage.safeParse(rawMsg);
      if (!msg.success) {
        skipped++;
        continue;
      }
      let updatedAt: number;
      try {
        updatedAt = parsePathTimestamp(msg.data.lastUpdated);
      } catch {
        skipped++;
        continue;
      }
      arrivals.push({
        system: "PATH",
        ...describeLine(msg.data.lineColor),
        direction,
        destination: msg.data.headSign,
        // secondsToArrival is relative to when PATH computed it, not to when we fetched it.
        arrivalTime: updatedAt + msg.data.secondsToArrival * 1000,
      });
    }
  }
  arrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
  return { arrivals, skipped };
}
