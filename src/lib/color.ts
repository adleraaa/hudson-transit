/**
 * Picks black or white text for a route bullet so labels stay readable on
 * yellow (N/Q/R/W) and orange/green PATH colors as well as dark blues and reds.
 * Uses WCAG relative luminance and compares contrast against both options.
 */
export function textColorFor(hex: string): "#000000" | "#FFFFFF" {
  const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithBlack > contrastWithWhite ? "#000000" : "#FFFFFF";
}
