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
  /**
   * How current the data is (epoch ms). Subway: the oldest MTA feed header timestamp among
   * the feeds serving this station, so a feed that stops advancing shows up here. PATH has
   * no feed-level timestamp, so it is the time this server fetched ridepath.json.
   */
  dataAsOf: z.number().int(),
  /**
   * True when the board may not be current: a refresh failed and cached data was served,
   * or a subway feed's own timestamp is more than 2 minutes old.
   */
  stale: z.boolean(),
  /**
   * Routes serving this station whose feed could not be loaded at all. Their trains are
   * missing from `arrivals`, so an empty board must not be read as "no service".
   */
  unavailableRoutes: z.array(z.string()),
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
