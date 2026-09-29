import { textColorFor } from "@/lib/color";
import type { Arrival } from "@/lib/schema";

/** Subway routes get the familiar round bullet; PATH lines get a pill with the line name. */
export function RouteBullet({
  arrival,
}: {
  arrival: Pick<Arrival, "system" | "route" | "routeColor">;
}) {
  const label = arrival.system === "PATH" ? `PATH ${arrival.route}` : `${arrival.route} train`;
  return (
    <span
      className={arrival.system === "PATH" ? "bullet bullet-path" : "bullet"}
      style={{ backgroundColor: `#${arrival.routeColor}`, color: textColorFor(arrival.routeColor) }}
      role="img"
      aria-label={label}
    >
      {arrival.route}
    </span>
  );
}
