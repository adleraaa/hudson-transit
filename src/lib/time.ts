/**
 * Display helpers. All clock times are formatted in America/New_York explicitly, so the
 * board is right even when the server (UTC on Vercel) or a traveler's phone is elsewhere.
 */
const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * A train that left up to this long ago may still be listed by the feeds (or still be on a
 * board that was fetched a moment ago). Within this window it is shown as "Now"; older is hidden.
 * Used by the parser, the server-side trim and the client render, so they always agree.
 */
export const DEPARTED_GRACE_MS = 30_000;

export function formatClock(epochMs: number): string {
  return clockFormat.format(epochMs);
}

/** Whole minutes until arrival, rounded down (a train 4m59s away is "4 min", like MTA countdown clocks). */
export function minutesUntil(arrivalTime: number, now: number): number {
  return Math.max(0, Math.floor((arrivalTime - now) / 60_000));
}

export function relativeLabel(arrivalTime: number, now: number): string {
  const diff = arrivalTime - now;
  if (diff <= DEPARTED_GRACE_MS) return "Now";
  if (diff < 60_000) return "<1 min";
  return `${minutesUntil(arrivalTime, now)} min`;
}
