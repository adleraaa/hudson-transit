import { expect, test, type Page } from "@playwright/test";

/**
 * UI smoke tests against the production build. /api/arrivals/* is mocked so the tests
 * are deterministic and never touch the real PATH/MTA endpoints.
 */
function board(stationId: string, stationName: string) {
  const now = Date.now();
  return {
    stationId,
    stationName,
    generatedAt: now,
    dataAsOf: now,
    stale: false,
    unavailableRoutes: [],
    warnings: [],
    arrivals: [
      {
        system: stationId.startsWith("path") ? "PATH" : "SUBWAY",
        route: stationId.startsWith("path") ? "HOB-33" : "L",
        routeColor: stationId.startsWith("path") ? "4D92FB" : "7C858C",
        direction: stationId.startsWith("path") ? "To New York" : "Brooklyn",
        destination: stationId.startsWith("path") ? "33rd Street" : "Canarsie-Rockaway Pkwy",
        arrivalTime: now + 5 * 60_000 + 20_000,
      },
    ],
  };
}

async function mockApi(page: Page) {
  await page.route("**/api/arrivals/*", async (route) => {
    const id = decodeURIComponent(route.request().url().split("/").pop()!);
    const name = id === "path-HOB" ? "Hoboken" : "14 St-Union Sq";
    await route.fulfill({ json: board(id, name) });
  });
}

test("shows Hoboken PATH by default with a relative arrival time", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Hoboken" })).toBeVisible();
  await expect(page.getByText("33rd Street")).toBeVisible();
  await expect(page.getByText("5 min")).toBeVisible();

  // Mobile-first: nothing may overflow horizontally on a phone-sized viewport.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("searching with the keyboard switches station and updates the URL", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  const search = page.getByRole("combobox", { name: "Find a station" });
  await search.fill("L union");
  await expect(page.getByRole("option", { name: /14 St-Union Sq/ })).toBeVisible();
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "14 St-Union Sq" })).toBeVisible();
  await expect(page).toHaveURL(/station=subway-602/);
});

test("favorites persist across reloads", async ({ page }) => {
  await mockApi(page);
  await page.goto("/?station=subway-602");
  await page.getByRole("button", { name: "Add 14 St-Union Sq to favorites" }).click();
  await page.goto("/");
  // The first favorite becomes the default station and appears as a chip.
  await expect(page.getByRole("heading", { name: "14 St-Union Sq" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Favorite stations" }).getByRole("button"),
  ).toHaveText(["14 St-Union Sq"]);
});

test("says which lines are missing instead of claiming there are no trains", async ({ page }) => {
  await page.route("**/api/arrivals/*", async (route) => {
    await route.fulfill({
      json: {
        ...board("subway-602", "14 St-Union Sq"),
        arrivals: [],
        unavailableRoutes: ["L"],
        warnings: ["L feed unavailable."],
      },
    });
  });
  await page.goto("/?station=subway-602");
  await expect(page.getByText("No live data for L trains right now")).toBeVisible();
  await expect(page.getByText("No trains predicted in the next hour.")).toHaveCount(0);
});

test("shows an error with a working retry when the API fails", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/arrivals/*", async (route) => {
    calls++;
    if (calls === 1) {
      await route.fulfill({ status: 503, json: { error: "PATH data unavailable" } });
    } else {
      await route.fulfill({ json: board("path-HOB", "Hoboken") });
    }
  });
  await page.goto("/");
  // Next.js also renders an empty role=alert route announcer, so filter by text.
  const alert = page.getByRole("alert").filter({ hasText: "Could not load arrivals" });
  await expect(alert).toContainText("PATH data unavailable");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("33rd Street")).toBeVisible();
});
