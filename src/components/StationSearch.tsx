"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { searchStations } from "@/lib/stations";
import type { Station } from "@/lib/schema";

type Props = { onSelect: (station: Station) => void };

/** Accessible combobox (WAI-ARIA 1.2 pattern): arrow keys move, Enter picks, Escape clears. */
export function StationSearch({ onSelect }: Props) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchStations(query), [query]);
  const open = results.length > 0;

  function choose(station: Station) {
    onSelect(station);
    setQuery("");
    setActive(0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      choose(results[Math.min(active, results.length - 1)]!);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }

  return (
    <div className="search">
      <label htmlFor={`${id}-input`} className="search-label">
        Find a station
      </label>
      <input
        id={`${id}-input`}
        className="search-input"
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        placeholder="Hoboken, 14 St, Times Sq, L..."
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listboxId} role="listbox" className="search-results" aria-label="Stations">
          {results.map((station, i) => (
            <li
              key={station.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className="search-option"
              // mousedown would blur the input before click fires; keep focus in the box.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(station)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="search-option-name">{station.name}</span>
              <span className="search-option-meta">
                {station.system === "PATH" ? "PATH" : station.borough} · {station.routes.join(" ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
