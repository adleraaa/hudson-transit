import { describe, expect, it } from "vitest";
import { textColorFor } from "@/lib/color";

describe("textColorFor", () => {
  it.each([
    ["F6BC26", "#000000"], // N/Q/R/W yellow
    ["FF9900", "#000000"], // PATH JSQ-33 orange
    ["0062CF", "#FFFFFF"], // A/C/E blue
    ["D82233", "#FFFFFF"], // 1/2/3 red
    ["000000", "#FFFFFF"],
    ["FFFFFF", "#000000"],
  ])("%s -> %s", (hex, expected) => {
    expect(textColorFor(hex)).toBe(expected);
  });
});
