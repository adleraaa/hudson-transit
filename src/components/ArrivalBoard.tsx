"use client";

import type { ArrivalsState } from "@/hooks/useArrivals";
import type { Arrival, Station } from "@/lib/schema";
import { formatClock, relativeLabel } from "@/lib/time";
import { RouteBullet } from "./RouteBullet";

type Props = {
  station: Station;
  state: ArrivalsState;
  now: number | null;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onRetry: () => void;
};

/** Groups by direction; groups are alphabetical so they don't jump around between refreshes. */
function groupByDirection(arrivals: Arrival[]): [string, Arrival[]][] {
  const groups = new Map<string, Arrival[]>();
  for (const a of arrivals) groups.set(a.direction, [...(groups.get(a.direction) ?? []), a]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function ArrivalBoard({
  station,
  state,
  now,
  isFavorite,
  onToggleFavorite,
  onRetry,
}: Props) {
  return (
    <section className="board" aria-labelledby="board-title" aria-busy={state.status === "loading"}>
      <header className="board-header">
        <div>
          <p className="board-system">
            {station.system === "PATH" ? "PATH" : `Subway · ${station.borough}`}
          </p>
          <h2 id="board-title" className="board-title">
            {station.name}
          </h2>
        </div>
        <button
          type="button"
          className="fav-button"
          aria-pressed={isFavorite}
          aria-label={
            isFavorite
              ? `Remove ${station.name} from favorites`
              : `Add ${station.name} to favorites`
          }
          onClick={onToggleFavorite}
        >
          <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
        </button>
      </header>

      <BoardBody state={state} now={now} onRetry={onRetry} />
    </section>
  );
}

function BoardBody({ state, now, onRetry }: Pick<Props, "state" | "now" | "onRetry">) {
  if (state.status === "idle" || state.status === "loading" || now === null) {
    return (
      <div className="board-message" role="status">
        <span className="spinner" aria-hidden="true" /> Loading arrivals...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="board-message board-error" role="alert">
        <p>Could not load arrivals: {state.message}</p>
        <button type="button" className="retry-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const { board, refreshError } = state;
  const upcoming = board.arrivals.filter((a) => a.arrivalTime >= now - 30_000);
  const groups = groupByDirection(upcoming);

  return (
    <>
      <p className="board-status" role="status">
        Updated {formatClock(board.dataAsOf)}
        {board.stale && <span className="badge badge-warn">Cached data</span>}
      </p>
      {refreshError && (
        <p className="board-note">Refresh failed ({refreshError}); showing the last update.</p>
      )}
      {board.warnings.length > 0 && (
        <details className="board-note">
          <summary>
            {board.warnings.length} data warning{board.warnings.length > 1 ? "s" : ""}
          </summary>
          <ul>
            {board.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {groups.length === 0 ? (
        <p className="board-message">No trains predicted in the next hour.</p>
      ) : (
        groups.map(([direction, arrivals]) => (
          <div key={direction} className="direction">
            <h3 className="direction-title">{direction}</h3>
            <ol className="arrivals">
              {arrivals.map((a) => (
                <li
                  key={`${a.tripId ?? a.route + a.destination}-${a.arrivalTime}`}
                  className="arrival"
                >
                  <RouteBullet arrival={a} />
                  <span className="arrival-dest">
                    {a.destination}
                    <span className="arrival-clock">{formatClock(a.arrivalTime)}</span>
                  </span>
                  <span className="arrival-eta">{relativeLabel(a.arrivalTime, now)}</span>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </>
  );
}
