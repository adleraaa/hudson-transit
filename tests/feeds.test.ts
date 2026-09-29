import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real PATH feed cache + loader; only the network call is faked.
const upstream = vi.hoisted(() => ({ fetchBytes: vi.fn<(url: string) => Promise<Uint8Array>>() }));
vi.mock("@/lib/upstream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upstream")>()),
  fetchBytes: upstream.fetchBytes,
}));

const { getPathFeed } = await import("@/lib/feeds");
const { buildBoard } = await import("@/lib/board");

const goodBody = readFileSync(new URL("./fixtures/ridepath.json", import.meta.url));
const bytes = (text: string) => new TextEncoder().encode(text);

describe("getPathFeed (real loader, faked network)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T00:20:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("keeps serving the last good copy when upstream starts returning the wrong shape", async () => {
    upstream.fetchBytes.mockResolvedValueOnce(new Uint8Array(goodBody));
    const first = await getPathFeed();
    expect(first.stale).toBe(false);

    // HTTP 200 with valid JSON that is not a ridepath.json body (e.g. a maintenance notice).
    vi.advanceTimersByTime(30_000);
    upstream.fetchBytes.mockResolvedValueOnce(bytes('{"results":null,"message":"maintenance"}'));
    const second = await getPathFeed();
    expect(second).toMatchObject({ stale: true, fetchedAt: first.fetchedAt });
    expect(second.error).toMatch(/unexpected ridepath.json shape/);
    expect(second.value).toBe(first.value);

    // The board built from it is a normal (stale-flagged) board, not a 500.
    const board = await buildBoard("path-HOB", {
      getPathFeed,
      getMtaFeed: () => Promise.reject(new Error("unused")),
      now: Date.now,
    });
    expect(board).toMatchObject({ stationName: "Hoboken", stale: true });
    expect(board!.arrivals.length).toBeGreaterThan(0);
  });
});
