/**
 * Re-records the small real upstream snapshots used by the unit tests.
 * Tests pin "now" to each snapshot's own timestamp, so re-recording is safe,
 * but expected counts in tests/*.test.ts may need updating afterwards.
 *
 * Usage: npm run fixtures
 */
import { writeFile } from "node:fs/promises";
import { PATH_URL, mtaFeedUrl } from "../src/lib/upstream";

const DIR = new URL("../tests/fixtures/", import.meta.url);
// Kept small on purpose: the L and Staten Island feeds are a few KB each, and
// A/C/E covers a busy Manhattan trunk (and 42 St-Port Authority in the Times Sq complex).
const FEEDS = ["-l", "-si", "-ace"] as const;

async function save(url: string, file: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeFile(new URL(file, DIR), bytes);
  console.log(`${file}: ${bytes.length} bytes`);
}

async function main() {
  await save(PATH_URL, "ridepath.json");
  for (const feed of FEEDS) await save(mtaFeedUrl(feed), `nyct-gtfs${feed}.pb`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
