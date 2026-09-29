# hudson-transit

[![CI](https://github.com/adleraaa/hudson-transit/actions/workflows/ci.yml/badge.svg)](https://github.com/adleraaa/hudson-transit/actions/workflows/ci.yml)

A live arrivals board for PATH and the NYC Subway, built with Next.js (App Router) and TypeScript. A
Hoboken-to-Manhattan commute usually mixes both systems, but they publish data in unrelated formats:
PATH exposes one JSON document with "seconds to arrival" per station, while the MTA publishes eight
GTFS-realtime protobuf feeds keyed by platform ids like `127N`. This app normalizes both into a single
zod-validated `Arrival` schema on the server, caches it briefly, and renders one mobile-first board with
station search, favorites and auto-refresh. No API keys are needed.

| Light (PATH, Hoboken)                                                                    | Dark (Subway, 14 St-Union Sq)                                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| <img src="docs/screenshot-light.png" width="260" alt="Hoboken PATH board in light mode"> | <img src="docs/screenshot-dark.png" width="260" alt="14 St-Union Sq subway board in dark mode"> |

Screenshots were captured from live data by `scripts/screenshot.ts` on 2026-09-28 around 8:30 PM ET.

## Results

Upstream feeds and station-index coverage, measured by `npm run probe` (3 rounds, 20 s apart,
2026-09-29 00:32 UTC, i9-14900HX laptop on a home connection in Hoboken, Node 24). Full output:
[`results/feed-probe.md`](results/feed-probe.md) / [`results/feed-probe.json`](results/feed-probe.json).

| Feed                   | OK rounds | Median size (KB) | Median fetch (ms) | Median decode + parse (ms) |
| ---------------------- | --------- | ---------------- | ----------------- | -------------------------- |
| PATH (`ridepath.json`) | 3/3       | 9.7              | 83                | 1.7                        |
| MTA 1-7, S             | 3/3       | 176.5            | 143               | 18                         |
| MTA A/C/E              | 3/3       | 101              | 91                | 5.8                        |
| MTA B/D/F/M            | 3/3       | 123.9            | 63                | 10.1                       |
| MTA G                  | 3/3       | 18.6             | 61                | 0.7                        |
| MTA J/Z                | 3/3       | 23.6             | 53                | 1                          |
| MTA N/Q/R/W            | 3/3       | 108.1            | 53                | 5                          |
| MTA L                  | 3/3       | 29.9             | 54                | 3.8                        |
| MTA SIR                | 3/3       | 6.4              | 44                | 0.5                        |

- Station coverage: in all 3 rounds, 13/13 PATH stations and 445/445 subway complexes had at least one
  predicted train that the parsers could attach to a named station.
- About 0.7% of stop references in the MTA feeds (104-105 of ~14,300 per round) use ids that are not in
  the static GTFS (for example `H19N`, `R60S`); they look like non-revenue timing points. The parser skips
  them and never shows them as a destination (covered by a unit test).
- The whole payload for one round (all 9 feeds) is about 600 KB, which is why the server fetches each
  feed once per TTL and shares it across all stations instead of fetching per request.

Tests: 66 vitest unit tests (parsers and normalizers against committed real snapshots, cache, route
handler, search, time zones) and 4 Playwright smoke tests against the production build with a mocked
API. These are correctness tests only; there is no load testing or production traffic data.

## Architecture

```
Browser (client component)                    Next.js server (Node runtime)
+----------------------------+   GET          +------------------------------------------+
| StationSearch (combobox)   | /api/arrivals/ | route.ts  -> buildBoard(stationId, deps) |
| favorites (localStorage)   |  path-HOB      |   PATH:   feed cache -> parsePathFeed    |
| useArrivals: poll 30 s     | -------------> |   Subway: 8 feed caches -> subwayArrivals|
|   only while tab visible   | <------------- |   trim to next hour, 6 per direction     |
| relative "N min" from now  |  Board (zod)   |   BoardSchema.parse(board) -> JSON       |
+----------------------------+                +------------------+-----------------------+
                                                                 | fetch, 6 s timeout
                                               createFeedCache: TTL 20 s, coalesced,
                                               stale-if-error up to 5 min
                                                                 |
                                   panynj.gov ridepath.json   api-endpoint.mta.info (x8 protobuf)
```

- `src/lib/path.ts`, `src/lib/mta.ts`: pure parsers from raw upstream data to `Arrival[]`.
- `src/lib/feed-cache.ts`, `src/lib/feeds.ts`: per-feed TTL cache with request coalescing and stale fallback.
- `src/lib/board.ts`: station id to `Board`; dependencies are injected so tests run on fixtures.
- `data/subway-stations.json`: 445 station complexes / 496 stops, generated by `scripts/build-stations.ts`.

## Quickstart

Requires Node 22.12+ (developed on Node 24).

```bash
npm ci
npm run dev            # http://localhost:3000
```

Checks (the same ones CI runs):

```bash
npx eslint . --max-warnings 0
npm run format:check
npm run typecheck
npm test               # vitest, offline
npm run build          # works with no env vars
npx playwright install chromium   # once; locally the config uses installed Chrome instead
npm run test:e2e       # needs the build; API is mocked
```

Reproduce the data and numbers (these hit the live endpoints):

```bash
npm run stations       # regenerate data/subway-stations.json from MTA static GTFS + NY Open Data
npm run fixtures       # re-record tests/fixtures/*
npm run probe          # rewrite results/feed-probe.{json,md}
```

## Design decisions

- **Absolute timestamps in the API, relative labels on the client.** The server returns epoch ms and
  the client computes "in N min" against its own clock every 10 s. A board cached for 15 s at the CDN
  or kept after a failed refresh therefore still counts down correctly.
- **Explicit time zones.** PATH timestamps carry their UTC offset (`-04:00`) and are parsed with it
  (after trimming microseconds, which ECMAScript does not guarantee to parse); GTFS-rt times are POSIX
  seconds. Clock times are formatted with `timeZone: "America/New_York"`. The unit tests run with
  `TZ=Asia/Tokyo` so code that leans on the machine's zone fails, and they cover the DST fall-back hour.
- **One shared, short-lived cache per feed with stale-if-error.** Upstreams refresh every ~15-30 s, so
  a 20 s TTL loses little freshness while turning N concurrent station requests into one upstream call.
  If a refresh fails, data up to 5 minutes old is served and flagged `stale`; the UI shows "Cached data"
  instead of a blank board. Past 5 minutes that feed counts as unavailable (503 if no feed has data), because old predictions
  mislead.
- **Query every MTA feed for every station.** Station data only lists daytime routes, and at night other
  lines run local (for example the D along 4 Av, which is in a different feed than the R). Since each
  feed is cached and shared, checking all eight cost about 0.5-0.8 ms of CPU per station in the probe
  (238-357 ms to scan all 445 complexes).
- **Station data from two official sources.** Static GTFS `stops.txt` gives stop names and `routes.txt`
  route colors, but not which platforms form one complex or what riders call each direction. The MTA
  "Subway Stations" dataset adds complex ids and labels like "Uptown" or "Brooklyn". Both are joined at
  build time into a 75 KB JSON so the client can search without a network round trip.
- **Server-side relay only.** Browsers never call PATH or MTA directly: the MTA data terms ask apps to
  serve data from their own servers, and it also avoids CORS and keeps the client payload small.

## Limitations

- The cache is in-process memory, so on Vercel each serverless instance has its own copy and a cold
  instance must fetch before it can serve stale data. A shared store (for example Redis) would fix
  this; it is not implemented.
- The CDN `s-maxage=15` header plus the 20 s server TTL and 30 s client poll mean that in the worst case a
  prediction can be over a minute old when it reaches the screen (upstream staleness not included).
- No MTA service alerts, elevator status or PATH advisories; only arrival predictions.
- Trains that terminate at the selected station are hidden (you cannot board them). Destinations use
  the last stop the feed lists, which during reroutes can differ from the train's signed destination.
- PATH line names are derived from the four published line colors; an unknown color shows as "PATH".
- Not yet deployed. The app builds with no environment variables and is intended for Vercel; the
  Vercel import is pending.

## Data sources and terms

- PATH real-time: `https://www.panynj.gov/bin/portauthority/ridepath.json` (Port Authority of NY & NJ).
  No published license was found for this endpoint; the repo includes one 9.6 KB snapshot as a test
  fixture only, and `npm run fixtures` re-records it.
- MTA subway GTFS-realtime feeds: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs`
  (and `-ace`, `-bdfm`, `-g`, `-jz`, `-nqrw`, `-l`, `-si`), used under the MTA data feed terms
  (https://www.mta.info/developers/terms-and-conditions). Three small snapshots are committed as fixtures.
- MTA static subway GTFS: https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip (same MTA terms).
- MTA Subway Stations on NY Open Data: https://data.ny.gov/d/39hk-dx4f (NY Open Data terms of use).

This project is not affiliated with or endorsed by the MTA or the Port Authority, and makes no claim
that the data is accurate, complete or timely.

## License

MIT, copyright 2026 Yunlong Lu. See [LICENSE](LICENSE). Data remains subject to the terms above.
