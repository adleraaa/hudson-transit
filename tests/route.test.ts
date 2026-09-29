import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The route handler imports the live feed caches; replace them with controllable fakes.
const feeds = vi.hoisted(() => ({
  getPathFeed: vi.fn(),
  getMtaFeed: vi.fn(),
}));
vi.mock("@/lib/feeds", () => feeds);

const { GET } = await import("@/app/api/arrivals/[stationId]/route");

const pathJson: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/ridepath.json", import.meta.url), "utf8"),
);

function call(stationId: string) {
  return GET(new Request(`http://test/api/arrivals/${stationId}`), {
    params: Promise.resolve({ stationId }),
  });
}

describe("GET /api/arrivals/[stationId]", () => {
  beforeEach(() => {
    feeds.getPathFeed.mockReset();
    feeds.getMtaFeed.mockReset();
  });

  it("returns a board with CDN caching headers", async () => {
    feeds.getPathFeed.mockResolvedValue({ value: pathJson, fetchedAt: Date.now(), stale: false });
    const res = await call("path-HOB");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=15, stale-while-revalidate=15");
    const body = await res.json();
    expect(body.stationName).toBe("Hoboken");
  });

  it("returns 404 for an unknown station", async () => {
    const res = await call("subway-nope");
    expect(res.status).toBe(404);
    expect(feeds.getMtaFeed).not.toHaveBeenCalled();
  });

  it("returns an uncached 503 when upstream is down and nothing is cached", async () => {
    feeds.getPathFeed.mockRejectedValue(new Error("www.panynj.gov timed out"));
    const res = await call("path-HOB");
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).error).toMatch(/timed out/);
  });
});
