import { describe, expect, it, vi } from "vitest";
import { createFeedCache } from "@/lib/feed-cache";

function setup(ttlMs = 20_000, maxStaleMs = 300_000) {
  let now = 1_000_000;
  const load = vi.fn<() => Promise<string>>();
  const get = createFeedCache(load, { ttlMs, maxStaleMs, now: () => now });
  return { get, load, advance: (ms: number) => (now += ms), now: () => now };
}

describe("createFeedCache", () => {
  it("serves from cache within the TTL and refetches after it", async () => {
    const { get, load, advance } = setup();
    load.mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    expect((await get()).value).toBe("v1");
    advance(19_999);
    expect((await get()).value).toBe("v1");
    expect(load).toHaveBeenCalledTimes(1);

    advance(1);
    expect((await get()).value).toBe("v2");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent refreshes into one upstream call", async () => {
    const { get, load } = setup();
    let resolve!: (v: string) => void;
    load.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const pending = [get(), get(), get()];
    resolve("v1");
    const results = await Promise.all(pending);
    expect(results.map((r) => r.value)).toEqual(["v1", "v1", "v1"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("serves the last good value, marked stale, when a refresh fails", async () => {
    const { get, load, advance, now } = setup();
    load.mockResolvedValueOnce("v1");
    await get();
    const firstFetch = now();

    advance(60_000);
    load.mockRejectedValueOnce(new Error("HTTP 502"));
    const result = await get();
    expect(result).toEqual({ value: "v1", fetchedAt: firstFetch, stale: true, error: "HTTP 502" });
  });

  it("gives up on stale data past maxStale and when there was never a good value", async () => {
    const { get, load, advance } = setup(20_000, 120_000);
    load.mockRejectedValueOnce(new Error("down"));
    await expect(get()).rejects.toThrow("down");

    advance(20_000); // past the failure backoff
    load.mockResolvedValueOnce("v1");
    await get();
    advance(120_001);
    load.mockRejectedValueOnce(new Error("still down"));
    await expect(get()).rejects.toThrow("still down");
  });

  it("backs off for one TTL after a failure, then recovers and clears the stale flag", async () => {
    const { get, load, advance } = setup();
    load
      .mockResolvedValueOnce("v1")
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValueOnce("v2");
    await get();
    advance(30_000);
    expect((await get()).stale).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);

    // Within the backoff window the stale value is served without calling upstream again,
    // so a hung upstream does not make every request wait for the fetch timeout.
    advance(19_999);
    expect(await get()).toMatchObject({ value: "v1", stale: true, error: "x" });
    expect(load).toHaveBeenCalledTimes(2);

    advance(1);
    expect(await get()).toMatchObject({ value: "v2", stale: false });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not wait on upstream again during backoff when there is nothing cached", async () => {
    const { get, load, advance } = setup();
    load.mockRejectedValueOnce(new Error("down"));
    await expect(get()).rejects.toThrow("down");
    advance(5_000);
    await expect(get()).rejects.toThrow("down");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
