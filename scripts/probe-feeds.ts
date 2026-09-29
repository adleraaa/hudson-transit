/**
 * Measures the live upstream feeds and how well the committed station index covers them.
 * Writes results/feed-probe.json and results/feed-probe.md (the README numbers come from here).
 *
 * Usage: npm run probe            (3 rounds, 20 s apart)
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { decodeFeed, feedTimestamp, subwayArrivals } from "../src/lib/mta";
import { parsePathFeed, parsePathTimestamp, PATH_STATIONS, readPathFeed } from "../src/lib/path";
import { trim } from "../src/lib/board";
import type { Arrival } from "../src/lib/schema";
import { getStop, SUBWAY_COMPLEXES } from "../src/lib/subway-data";
import { DEPARTED_GRACE_MS } from "../src/lib/time";
import { fetchBytes, MTA_FEEDS, mtaFeedUrl, PATH_URL } from "../src/lib/upstream";

const ROUNDS = Number(process.env.ROUNDS ?? 3);
const GAP_MS = 20_000;

/**
 * decodeMs: MTA = protobuf decode only; PATH = JSON.parse + shape check + parsing all 13
 * stations (PATH has no separate decode step). ageS: seconds between the feed's own
 * timestamp and the moment the fetch finished (MTA: header timestamp; PATH: the newest
 * per-prediction lastUpdated in the whole document).
 */
type FeedSample = {
  feed: string;
  ok: boolean;
  bytes: number;
  fetchMs: number;
  decodeMs: number;
  ageS: number;
};

const failed = (feed: string): FeedSample => ({
  feed,
  ok: false,
  bytes: 0,
  fetchMs: NaN,
  decodeMs: NaN,
  ageS: NaN,
});

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : NaN;
};

/** The board's previous rule, kept here only for comparison: next hour, 6 per direction label. */
function capPerDirection(arrivals: Arrival[], now: number): Arrival[] {
  const seen = new Map<string, number>();
  return arrivals
    .filter((a) => a.arrivalTime >= now - DEPARTED_GRACE_MS && a.arrivalTime <= now + 60 * 60_000)
    .sort((a, b) => a.arrivalTime - b.arrivalTime)
    .filter((a) => {
      const n = seen.get(a.direction) ?? 0;
      seen.set(a.direction, n + 1);
      return n < 6;
    });
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const value = await fn();
  return [value, performance.now() - t0];
}

async function round() {
  const samples: FeedSample[] = [];
  const now = Date.now();

  // PATH
  let pathStationsWithTrains = 0;
  try {
    const [bytes, fetchMs] = await timed(() => fetchBytes(PATH_URL, 10_000));
    const fetchedAt = Date.now();
    const t0 = performance.now();
    const json = readPathFeed(JSON.parse(new TextDecoder().decode(bytes)));
    const perStation = Object.keys(PATH_STATIONS).map((c) => parsePathFeed(json, c));
    const decodeMs = performance.now() - t0;
    const updated = json.results.flatMap((r) =>
      r.destinations.flatMap((d) =>
        d.messages.map((m) => parsePathTimestamp((m as { lastUpdated: string }).lastUpdated)),
      ),
    );
    samples.push({
      feed: "PATH",
      ok: true,
      bytes: bytes.length,
      fetchMs,
      decodeMs,
      ageS: (fetchedAt - Math.max(...updated)) / 1000,
    });
    pathStationsWithTrains = perStation.filter((r) => r.arrivals.length > 0).length;
  } catch {
    samples.push(failed("PATH"));
  }

  // MTA
  const decoded: ReturnType<typeof decodeFeed>[] = [];
  let stopRefs = 0;
  let unresolvedRefs = 0;
  const unresolvedIds = new Set<string>();
  for (const feed of MTA_FEEDS) {
    const label = feed === "" ? "1234567S" : feed.slice(1).toUpperCase();
    try {
      const [bytes, fetchMs] = await timed(() => fetchBytes(mtaFeedUrl(feed), 10_000));
      const fetchedAt = Date.now();
      const t0 = performance.now();
      const msg = decodeFeed(bytes);
      samples.push({
        feed: label,
        ok: true,
        bytes: bytes.length,
        fetchMs,
        decodeMs: performance.now() - t0,
        ageS: (fetchedAt - (feedTimestamp(msg) ?? NaN)) / 1000,
      });
      decoded.push(msg);
      for (const e of msg.entity) {
        for (const stu of e.tripUpdate?.stopTimeUpdate ?? []) {
          stopRefs++;
          if (stu.stopId && !getStop(stu.stopId)) {
            unresolvedRefs++;
            unresolvedIds.add(stu.stopId);
          }
        }
      }
    } catch {
      samples.push(failed(label));
    }
  }

  const t0 = performance.now();
  let complexesWithTrains = 0;
  for (const complex of SUBWAY_COMPLEXES) {
    if (decoded.some((msg) => subwayArrivals(msg, complex, now).length > 0)) complexesWithTrains++;
  }
  const allStationsMs = performance.now() - t0;

  // Board cap check: how many complexes would lose a whole route from the board under the
  // previous rule (6 trains per direction label) versus the current trim() (3 per route and
  // direction). A route counts if it has at least one train in the next hour.
  let hiddenByOldCap = 0;
  let hiddenByTrim = 0;
  const hiddenAt611: string[] = [];
  const routes = (xs: Arrival[]) => new Set(xs.map((a) => a.route));
  for (const complex of SUBWAY_COMPLEXES) {
    const all = decoded.flatMap((msg) => subwayArrivals(msg, complex, now));
    const inHour = routes(all.filter((a) => a.arrivalTime <= now + 60 * 60_000));
    const oldShown = routes(capPerDirection(all, now));
    const newShown = routes(trim(all, now));
    if (oldShown.size < inHour.size) hiddenByOldCap++;
    if (newShown.size < inHour.size) hiddenByTrim++;
    if (complex.id === "611") hiddenAt611.push(...[...inHour].filter((r) => !oldShown.has(r)));
  }

  return {
    at: new Date(now).toISOString(),
    samples,
    pathStationsWithTrains,
    complexesWithTrains,
    stopRefs,
    unresolvedRefs,
    unresolvedIds: [...unresolvedIds].sort(),
    allStationsMs,
    hiddenByOldCap,
    hiddenByTrim,
    hiddenAt611: hiddenAt611.sort(),
  };
}

async function main() {
  const rounds: Awaited<ReturnType<typeof round>>[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
    rounds.push(await round());
    console.log(`round ${i + 1}/${ROUNDS} done`);
  }

  const feeds = [...new Set(rounds.flatMap((r) => r.samples.map((s) => s.feed)))];
  const perFeed = feeds.map((feed) => {
    const ss = rounds.flatMap((r) => r.samples.filter((s) => s.feed === feed));
    const ok = ss.filter((s) => s.ok);
    return {
      feed,
      okRounds: `${ok.length}/${ss.length}`,
      medianKiB: Math.round(median(ok.map((s) => s.bytes)) / 102.4) / 10,
      medianFetchMs: Math.round(median(ok.map((s) => s.fetchMs))),
      medianDecodeMs: Math.round(median(ok.map((s) => s.decodeMs)) * 10) / 10,
      ageSeconds: ok.map((s) => Math.round(s.ageS)),
    };
  });

  const summary = {
    generatedBy: "scripts/probe-feeds.ts",
    machine: `${os.cpus()[0]?.model.trim()} / ${os.platform()} / Node ${process.version}`,
    rounds: rounds.length,
    perFeed,
    pathStations: Object.keys(PATH_STATIONS).length,
    subwayComplexes: SUBWAY_COMPLEXES.length,
    perRound: rounds.map((r) => ({
      at: r.at,
      pathStationsWithTrains: r.pathStationsWithTrains,
      complexesWithTrains: r.complexesWithTrains,
      stopRefs: r.stopRefs,
      unresolvedRefs: r.unresolvedRefs,
      unresolvedIds: r.unresolvedIds,
      allStationsMs: Math.round(r.allStationsMs),
      hiddenByOldCap: r.hiddenByOldCap,
      hiddenByTrim: r.hiddenByTrim,
      hiddenAt611: r.hiddenAt611,
    })),
  };

  const md = [
    `# Feed probe`,
    ``,
    `Generated by \`npm run probe\` (${summary.rounds} rounds, ${GAP_MS / 1000} s apart).`,
    `Machine: ${summary.machine}. Rounds: ${rounds.map((r) => r.at).join(", ")}.`,
    ``,
    `Decode/parse: MTA = protobuf decode only; PATH = JSON.parse + shape check + parse of all 13 stations.`,
    `Data age: seconds from the feed's own timestamp to the end of the fetch, one value per round`,
    `(MTA: header timestamp; PATH: newest per-prediction lastUpdated in the document).`,
    ``,
    `| Feed | OK rounds | Median size (KiB) | Median fetch (ms) | Median decode/parse (ms) | Data age at fetch (s) |`,
    `|---|---|---|---|---|---|`,
    ...perFeed.map(
      (f) =>
        `| ${f.feed} | ${f.okRounds} | ${f.medianKiB} | ${f.medianFetchMs} | ${f.medianDecodeMs} | ${f.ageSeconds.join(", ")} |`,
    ),
    ``,
    `| Round | PATH stations with trains | Subway complexes with trains | Stop refs | Unresolved stop refs | All-stations scan, wall time (ms) |`,
    `|---|---|---|---|---|---|`,
    ...summary.perRound.map(
      (r) =>
        `| ${r.at} | ${r.pathStationsWithTrains}/${summary.pathStations} | ${r.complexesWithTrains}/${summary.subwayComplexes} | ${r.stopRefs} | ${r.unresolvedRefs} (${r.unresolvedIds.join(", ") || "none"}) | ${r.allStationsMs} |`,
    ),
    ``,
    `Board cap check: subway complexes where at least one route with a train in the next hour`,
    `would be missing from the board (of ${summary.subwayComplexes}).`,
    ``,
    `| Round | Previous rule: 6 per direction | Current trim(): 3 per route and direction | Routes the previous rule hid at Times Sq (611) |`,
    `|---|---|---|---|`,
    ...summary.perRound.map(
      (r) =>
        `| ${r.at} | ${r.hiddenByOldCap} | ${r.hiddenByTrim} | ${r.hiddenAt611.join(", ") || "none"} |`,
    ),
    ``,
  ].join("\n");

  await mkdir(new URL("../results/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../results/feed-probe.json", import.meta.url),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await writeFile(new URL("../results/feed-probe.md", import.meta.url), md);
  console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
