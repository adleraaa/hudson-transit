/**
 * Captures README screenshots from a running server with live data, in light and dark mode
 * at a phone-sized viewport. Headless only.
 *
 * Usage: npm run build && npx next start -p 3100 &  then  npx tsx scripts/screenshot.ts
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = [
  { file: "docs/screenshot-light.png", scheme: "light", station: "path-HOB" },
  { file: "docs/screenshot-dark.png", scheme: "dark", station: "subway-602" },
] as const;

async function main() {
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome" });
  for (const shot of SHOTS) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: shot.scheme,
    });
    await page.goto(`${BASE}/?station=${shot.station}`);
    await page.locator(".arrival").first().waitFor({ timeout: 20_000 });
    await page.screenshot({ path: shot.file });
    console.log(`wrote ${shot.file}`);
    await page.close();
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
