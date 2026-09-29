import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
  },
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        // Locally reuse the installed Chrome instead of downloading Playwright's Chromium.
        channel: process.env.CI ? undefined : "chrome",
      },
    },
  ],
  webServer: {
    // Requires `npm run build` first. The smoke tests mock /api/*, so no network is needed.
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
