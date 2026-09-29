import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBoard, BoardUnavailableError, type BoardDeps } from "@/lib/board";
import { decodeFeed, feedTimestamp } from "@/lib/mta";
import { BoardSchema } from "@/lib/schema";
import type { MtaFeed } from "@/lib/upstream";

const pathJson: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/ridepath.json", import.meta.url), "utf8"),
);
const lFeed = decodeFeed(readFileSync(new URL("./fixtures/nyct-gtfs-l.pb", import.meta.url)));
const aceFeed = decodeFeed(readFileSync(new URL("./fixtures/nyct-gtfs-ace.pb", import.meta.url)));
const NOW = feedTimestamp(lFeed)!;

function deps(overrides: Partial<BoardDeps> = {}): BoardDeps {
  const available: Partial<Record<MtaFeed, typeof lFeed>> = { "-l": lFeed, "-ace": aceFeed };
  return {
    now: () => NOW,
    getPathFeed: async () => ({ value: pathJson, fetchedAt: NOW, stale: false }),
    getMtaFeed: async (feed) => {
      const value = available[feed];
      if (!value) throw new Error("not recorded");
      return { value, fetchedAt: NOW - 5_000, stale: false };
    },
    ...overrides,
  };
}

describe("buildBoard", () => {
  it("builds a schema-valid PATH board", async () => {
    const board = await buildBoard("path-HOB", deps());
    expect(BoardSchema.parse(board)).toEqual(board);
    expect(board).toMatchObject({ stationName: "Hoboken", stale: false, warnings: [] });
    expect(board!.arrivals.length).toBeGreaterThan(0);
  });

  it("merges subway feeds and reports the ones that failed", async () => {
    const board = (await buildBoard("subway-602", deps()))!;
    expect(BoardSchema.safeParse(board).success).toBe(true);
    expect(board.stationName).toBe("14 St-Union Sq");
    expect(new Set(board.arrivals.map((a) => a.route))).toEqual(new Set(["L"]));
    // 6 of the 8 feeds were not recorded in this test.
    expect(board.warnings).toHaveLength(6);
    expect(board.warnings).toContain("1-7/S feed unavailable.");
    expect(board.dataAsOf).toBe(NOW - 5_000);
  });

  it("caps each direction at 8 trains within the next hour", async () => {
    const board = (await buildBoard("subway-602", deps()))!;
    const counts = new Map<string, number>();
    for (const a of board.arrivals) {
      counts.set(a.direction, (counts.get(a.direction) ?? 0) + 1);
      expect(a.arrivalTime).toBeLessThanOrEqual(NOW + 60 * 60_000);
    }
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(8);
  });

  it("marks the board stale when served from cache after an upstream error", async () => {
    const board = await buildBoard(
      "path-HOB",
      deps({
        getPathFeed: async () => ({
          value: pathJson,
          fetchedAt: NOW - 90_000,
          stale: true,
          error: "www.panynj.gov timed out",
        }),
      }),
    );
    expect(board!.stale).toBe(true);
    expect(board!.warnings[0]).toMatch(/timed out/);
  });

  it("throws BoardUnavailableError when no data at all is available", async () => {
    const failing = deps({
      getPathFeed: async () => {
        throw new Error("down");
      },
      getMtaFeed: async () => {
        throw new Error("down");
      },
    });
    await expect(buildBoard("path-HOB", failing)).rejects.toBeInstanceOf(BoardUnavailableError);
    await expect(buildBoard("subway-602", failing)).rejects.toBeInstanceOf(BoardUnavailableError);
  });

  it.each(["path-XYZ", "path-toString", "subway-999999", "bus-1", "path", ""])(
    "returns null for unknown station id %j",
    async (id) => {
      expect(await buildBoard(id, deps())).toBeNull();
    },
  );
});
