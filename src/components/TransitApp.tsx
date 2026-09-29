"use client";

import { useEffect, useState } from "react";
import { useArrivals } from "@/hooks/useArrivals";
import { useNow } from "@/hooks/useNow";
import { loadFavorites, saveFavorites, toggleFavorite } from "@/lib/favorites";
import type { Station } from "@/lib/schema";
import { DEFAULT_STATION_ID, getStation } from "@/lib/stations";
import { ArrivalBoard } from "./ArrivalBoard";
import { StationSearch } from "./StationSearch";

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined; // accessing localStorage itself can throw when site data is blocked
  }
}

export function TransitApp() {
  const [stationId, setStationId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const { state, reload } = useArrivals(stationId);
  const now = useNow();

  // URL and localStorage only exist in the browser, so the initial station is picked
  // after hydration: ?station=... wins, then the first favorite, then Hoboken PATH.
  useEffect(() => {
    const saved = loadFavorites(storage()).filter((id) => getStation(id));
    const fromUrl = new URLSearchParams(window.location.search).get("station");
    const initial = [fromUrl, saved[0], DEFAULT_STATION_ID].find((id) => id && getStation(id))!;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser-only state
    setFavorites(saved);
    setStationId(initial);
  }, []);

  function select(station: Station) {
    setStationId(station.id);
    const url = new URL(window.location.href);
    url.searchParams.set("station", station.id);
    // replaceState: switching stations should not fill the back-button history.
    window.history.replaceState(null, "", url);
  }

  function toggle(id: string) {
    const next = toggleFavorite(favorites, id);
    setFavorites(next);
    saveFavorites(storage(), next);
  }

  const station = stationId ? getStation(stationId) : undefined;
  const favoriteStations = favorites.map(getStation).filter((s): s is Station => !!s);

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">Hudson Transit</h1>
        <p className="app-subtitle">Live PATH and NYC Subway arrivals</p>
      </header>

      <StationSearch onSelect={select} />

      {favoriteStations.length > 0 && (
        <nav aria-label="Favorite stations" className="favorites">
          {favoriteStations.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              aria-current={s.id === stationId ? "true" : undefined}
              onClick={() => select(s)}
            >
              {s.name}
            </button>
          ))}
        </nav>
      )}

      {station ? (
        <ArrivalBoard
          station={station}
          state={state}
          now={now}
          isFavorite={favorites.includes(station.id)}
          onToggleFavorite={() => toggle(station.id)}
          onRetry={reload}
        />
      ) : (
        <div className="board board-message" role="status">
          Loading...
        </div>
      )}

      <footer className="app-footer">
        Data from Port Authority of NY &amp; NJ (PATH) and MTA (NYC Subway) real-time feeds, relayed
        through this site&apos;s server. Predictions may be delayed, incomplete or inaccurate;
        &quot;Cached data&quot; means they may not be real time. Times are New York time. Not
        affiliated with or endorsed by either agency.
      </footer>
    </main>
  );
}
