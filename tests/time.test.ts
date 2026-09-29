import { describe, expect, it } from "vitest";
import { formatClock, minutesUntil, relativeLabel } from "@/lib/time";

describe("formatClock", () => {
  // vitest.config.ts sets TZ=Asia/Tokyo, so these only pass if New York time is explicit.
  it("formats in New York time during daylight saving (UTC-4)", () => {
    expect(formatClock(Date.UTC(2026, 8, 29, 0, 15))).toBe("8:15 PM");
  });

  it("formats in New York time in winter (UTC-5)", () => {
    expect(formatClock(Date.UTC(2026, 0, 15, 13, 5))).toBe("8:05 AM");
  });

  it("handles the fall-back transition hour", () => {
    // 2026-11-01 05:30Z = 1:30 AM EDT; 06:30Z = 1:30 AM EST (clocks repeat the hour).
    expect(formatClock(Date.UTC(2026, 10, 1, 5, 30))).toBe("1:30 AM");
    expect(formatClock(Date.UTC(2026, 10, 1, 6, 30))).toBe("1:30 AM");
  });
});

describe("relative times", () => {
  const now = 1_790_000_000_000;

  it("rounds down to whole minutes", () => {
    expect(minutesUntil(now + 4 * 60_000 + 59_000, now)).toBe(4);
    expect(minutesUntil(now - 10_000, now)).toBe(0);
  });

  it("labels imminent trains", () => {
    expect(relativeLabel(now - 5_000, now)).toBe("Now");
    expect(relativeLabel(now + 30_000, now)).toBe("Now");
    expect(relativeLabel(now + 45_000, now)).toBe("<1 min");
    expect(relativeLabel(now + 60_000, now)).toBe("1 min");
    expect(relativeLabel(now + 12 * 60_000 + 30_000, now)).toBe("12 min");
  });
});
