"use client";

import { useEffect, useState } from "react";

/**
 * Current time, re-read every `intervalMs`, so "in N min" labels count down between
 * data refreshes. Starts as null during server render to avoid hydration mismatches.
 */
export function useNow(intervalMs = 10_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
