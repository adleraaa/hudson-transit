import { describe, expect, it } from "vitest";
import {
  FAVORITES_KEY,
  loadFavorites,
  parseFavorites,
  saveFavorites,
  toggleFavorite,
} from "@/lib/favorites";

describe("favorites", () => {
  it("parses only a JSON array of unique non-empty strings", () => {
    expect(parseFavorites('["path-HOB","subway-611","path-HOB",3,""]')).toEqual([
      "path-HOB",
      "subway-611",
    ]);
    expect(parseFavorites('{"a":1}')).toEqual([]);
    expect(parseFavorites("not json")).toEqual([]);
    expect(parseFavorites(null)).toEqual([]);
  });

  it("toggles on and off and keeps at most 12", () => {
    expect(toggleFavorite(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFavorite(["a", "b"], "a")).toEqual(["b"]);
    const many = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const next = toggleFavorite(many, "new");
    expect(next).toHaveLength(12);
    expect(next.at(-1)).toBe("new");
    expect(next).not.toContain("s0");
  });

  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    saveFavorites(storage, ["path-HOB"]);
    expect(store.get(FAVORITES_KEY)).toBe('["path-HOB"]');
    expect(loadFavorites(storage)).toEqual(["path-HOB"]);
  });

  it("survives storage that throws or is missing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadFavorites(throwing)).toEqual([]);
    expect(() => saveFavorites(throwing, ["x"])).not.toThrow();
    expect(loadFavorites(undefined)).toEqual([]);
  });
});
