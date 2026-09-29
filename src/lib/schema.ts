import { z } from "zod";

/**
 * The single normalized shape both upstream systems are converted into.
 * Times are absolute epoch milliseconds: relative "in N min" labels are computed
 * on the client at render time, so a cached board never shows stale countdowns.
 */
export const ArrivalSchema = z.object({
  system: z.enum(["PATH", "SUBWAY"]),
  /** Short route label shown in the bullet, e.g. "A", "7X", "HOB-33". */
  route: z.string().min(1),
  /** Hex color without '#', e.g. "0039A6". */
  routeColor: z.string().regex(/^[0-9A-Fa-f]{6}$/),
  /** Rider-facing direction group, e.g. "Uptown", "To New York". */
  direction: z.string().min(1),
  /** Where the train is going, e.g. "World Trade Center", "Far Rockaway-Mott Av". */
  destination: z.string().min(1),
  arrivalTime: z.number().int().positive(),
  tripId: z.string().optional(),
});
export type Arrival = z.infer<typeof ArrivalSchema>;

export const BoardSchema = z.object({
  stationId: z.string(),
  stationName: z.string(),
  arrivals: z.array(ArrivalSchema),
  /** When this server produced the response (epoch ms). */
  generatedAt: z.number().int(),
  /** Oldest upstream fetch time among the feeds that went into this board (epoch ms). */
  dataAsOf: z.number().int(),
  /** True when at least one feed failed and cached data was served instead. */
  stale: z.boolean(),
  /** Human-readable upstream problems; empty when everything was fresh. */
  warnings: z.array(z.string()),
});
export type Board = z.infer<typeof BoardSchema>;

/** A place a rider can pick in the search box. */
export type Station = {
  id: string;
  system: "PATH" | "SUBWAY";
  name: string;
  /** Extra search/display hint, e.g. borough or the routes that stop there. */
  routes: string[];
  borough?: string;
};
