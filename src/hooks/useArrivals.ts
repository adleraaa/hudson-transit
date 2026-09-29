"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BoardSchema, type Board } from "@/lib/schema";

/** At or above the 20 s server cache TTL (feeds.ts); polling faster would mostly hit the cache. */
export const REFRESH_MS = 30_000;

export type ArrivalsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; board: Board; refreshError?: string }
  | { status: "error"; message: string };

async function fetchBoard(stationId: string, signal: AbortSignal): Promise<Board> {
  const res = await fetch(`/api/arrivals/${encodeURIComponent(stationId)}`, { signal });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  // The server validates too; checking here guards against a proxy or old deploy.
  return BoardSchema.parse(body);
}

/**
 * Loads a station's board and keeps it fresh while the tab is visible.
 * Polling stops when the tab is hidden (saves phone battery and upstream load) and a
 * refresh runs immediately when the rider comes back, if the data is older than REFRESH_MS.
 * A failed refresh keeps showing the last good board with an error note.
 */
export function useArrivals(stationId: string | null) {
  const [state, setState] = useState<ArrivalsState>(
    stationId ? { status: "loading" } : { status: "idle" },
  );
  const [prevStationId, setPrevStationId] = useState(stationId);
  const [reloadToken, setReloadToken] = useState(0);
  const lastLoadedAt = useRef(0);

  // Reset during render when the station changes (React's recommended pattern), so
  // the previous station's trains are never shown under the new station's name.
  if (stationId !== prevStationId) {
    setPrevStationId(stationId);
    setState(stationId ? { status: "loading" } : { status: "idle" });
  }

  useEffect(() => {
    if (!stationId) return;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const board = await fetchBoard(stationId, controller.signal);
        if (cancelled) return;
        lastLoadedAt.current = Date.now();
        setState({ status: "ready", board });
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        setState((prev) =>
          prev.status === "ready"
            ? { ...prev, refreshError: message }
            : { status: "error", message },
        );
      }
    };

    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(async () => {
        await load();
        if (!cancelled) schedule();
      }, REFRESH_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearTimeout(timer);
        return;
      }
      if (Date.now() - lastLoadedAt.current >= REFRESH_MS) void load();
      schedule();
    };

    void load().then(() => {
      if (!cancelled) schedule();
    });
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [stationId, reloadToken]);

  const reload = useCallback(() => {
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    setReloadToken((n) => n + 1);
  }, []);
  return { state, reload };
}
