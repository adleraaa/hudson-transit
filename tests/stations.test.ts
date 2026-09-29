import { describe, expect, it } from "vitest";
import { ALL_STATIONS, getStation, normalize, searchStations } from "@/lib/stations";

describe("station index", () => {
  it("has 13 PATH stations plus the subway complexes, with unique ids", () => {
    expect(ALL_STATIONS.filter((s) => s.system === "PATH")).toHaveLength(13);
    expect(ALL_STATIONS.filter((s) => s.system === "SUBWAY").length).toBeGreaterThan(400);
    expect(new Set(ALL_STATIONS.map((s) => s.id)).size).toBe(ALL_STATIONS.length);
    expect(getStation("path-HOB")?.name).toBe("Hoboken");
  });
});

describe("normalize", () => {
  it("makes PATH and MTA spellings comparable", () => {
    expect(normalize("14th Street")).toBe("14 st");
    expect(normalize("14 St")).toBe("14 st");
    expect(normalize("Times Sq-42 St")).toBe("times sq 42 st");
    expect(normalize("Nostrand Avenue")).toBe("nostrand av");
  });
});

describe("searchStations", () => {
  it("ranks the name-prefix match first", () => {
    expect(searchStations("hob")[0]?.id).toBe("path-HOB");
    expect(searchStations("times sq")[0]?.name).toMatch(/^Times Sq-42 St/);
  });

  it("finds both PATH and subway stations for a shared street name", () => {
    const ids = searchStations("14 street", undefined, 20).map((s) => s.id);
    expect(ids).toContain("path-14S");
    expect(ids.some((id) => id.startsWith("subway-"))).toBe(true);
  });

  it("combines a route with a name word", () => {
    const results = searchStations("L union");
    expect(results.map((s) => s.name)).toEqual(["14 St-Union Sq"]);
  });

  it("requires every word to match and respects the limit", () => {
    expect(searchStations("hoboken nowhere")).toEqual([]);
    expect(searchStations("   ")).toEqual([]);
    expect(searchStations("st", undefined, 5)).toHaveLength(5);
  });
});
