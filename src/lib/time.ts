/**
 * Display helpers. All clock times are formatted in America/New_York explicitly, so the
 * board is right even when the server (UTC on Vercel) or a traveler's phone is elsewhere.
 */
const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

export function formatClock(epochMs: number): string {
  return clockFormat.format(epochMs);
}

/** Whole minutes until arrival, rounded down (a train 4m59s away is "4 min", like MTA countdown clocks). */
export function minutesUntil(arrivalTime: number, now: number): number {
  return Math.max(0, Math.floor((arrivalTime - now) / 60_000));
}

export function relativeLabel(arrivalTime: number, now: number): string {
  const diff = arrivalTime - now;
  if (diff <= 30_000) return "Now";
  if (diff < 60_000) return "<1 min";
  return `${minutesUntil(arrivalTime, now)} min`;
}
