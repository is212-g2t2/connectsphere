import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEED_STAFF_PASSWORD } from "../../scripts/seed";

// Sign-up can only mint external roles, so the Venue Staff account comes from the seed that
// `global-setup.ts` runs once before the suite.

async function signInAsVenueStaff(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: "venue.staff.seed@example.com", password: SEED_STAFF_PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function signUpAsOrganiser(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: "Event organiser",
      email: `venues-${randomUUID()}@example.invalid`,
      password: "Venues123!",
      role: "event_organiser",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test.describe("Venue records", () => {
  test("redirects an unauthenticated visitor to login", async ({ page }) => {
    await page.goto("/venues");
    await expect(page).toHaveURL(/\/login/);
  });

  test("lets Venue Staff create a venue and see it in the catalogue", async ({ page }) => {
    await signInAsVenueStaff(page);
    const name = `Playwright Room ${randomUUID().slice(0, 8)}`;

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: "Venues", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Venues" })).toBeVisible();
    await page.getByRole("link", { name: "New venue" }).click();
    await expect(page.getByRole("heading", { name: "New venue" })).toBeVisible();
    // Controlled inputs: typing before hydration completes is thrown away when React attaches.
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Venue name", { exact: true }).fill(name);
    await page.getByLabel("Location", { exact: true }).fill("Level 4");
    await page.getByLabel("Maximum capacity", { exact: true }).fill("25");
    await page.getByLabel("Facilities", { exact: true }).fill("Projector, Whiteboard");
    await page.getByRole("checkbox", { name: "Classroom" }).click();
    await page.getByRole("button", { name: "Create venue" }).click();

    await expect(page).toHaveURL(/\/venues\/\d+/);
    await expect(page.getByText("Venue saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByRole("link", { name: "Back to venues" }).click();
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  });

  test("refuses an organiser the catalogue and hides the dashboard link", async ({ page }) => {
    await signUpAsOrganiser(page);

    await page.goto("/venues");
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /welcome,/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Venues", exact: true })).toHaveCount(0);
  });
});
