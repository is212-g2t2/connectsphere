import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForHydration } from "./hydration";
import { signInWithSeedPassword as signInAsSeeded } from "./staff-auth";

async function signInAsVenueStaff(page: Page): Promise<void> {
  await signInAsSeeded(page, "venue.staff.seed@example.com");
}

test.describe("Room layouts", () => {
  test("redirects an unauthenticated visitor to login", async ({ page }) => {
    await page.goto("/venues/layouts");
    await expect(page).toHaveURL(/\/login/);
  });

  test("sends a Coordinator back to the catalogue", async ({ page }) => {
    await signInAsSeeded(page, "coordinator.seed@example.com");

    await page.goto("/venues/layouts");
    await expect(page).toHaveURL(/\/venues$/);
    await expect(page.getByRole("heading", { name: "Room layouts" })).toHaveCount(0);
  });

  test("lets Venue Staff add a layout type and see it in the list", async ({ page }) => {
    await signInAsVenueStaff(page);
    const suffix = randomUUID().slice(0, 8);
    const label = `Playwright ${suffix}`;

    await page.goto("/venues/layouts");
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Room layouts" })).toBeVisible();

    await page.getByLabel("Label", { exact: true }).fill(label);
    await page.getByRole("button", { name: "Add layout" }).click();

    await expect(page.getByRole("cell", { name: label, exact: true })).toBeVisible();
  });
});
