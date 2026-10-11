import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForHydration } from "./hydration";
import { signInWithSeedPassword as signInAsSeeded } from "./staff-auth";

// Sign-up creates only external roles. These tests use internal accounts from the seed in
// `global-setup.ts`.

async function signInAsVenueStaff(page: Page): Promise<void> {
  await signInAsSeeded(page, "venue.staff.seed@example.com");
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

/** The location recorded by the helper below, for tests to check. */
const CREATED_LOCATION = "Level 4, Playwright Wing";

/** Create a venue through the form and return its detail path. Each test creates its own row to
 * avoid races on the shared seed venues. Read the path after the detail route removes
 * `?saved=true`; that effect changes the URL.
 */
async function createVenue(page: Page, name: string): Promise<string> {
  await page.goto("/venues/new");
  // Wait for hydration before typing. React discards input sent before it attaches.
  await waitForHydration(page);

  await page.getByLabel("Venue name", { exact: true }).fill(name);
  await page.getByLabel("Location", { exact: true }).fill(CREATED_LOCATION);
  await page.getByLabel("Maximum capacity", { exact: true }).fill("25");
  await page.getByLabel("Facilities", { exact: true }).fill("Projector, Whiteboard");
  await page.getByLabel("Accessibility features", { exact: true }).fill("Step-free access");
  await page.getByRole("checkbox", { name: "Theatre" }).click();
  await page.getByRole("button", { name: "Create venue" }).click();

  await expect(page).toHaveURL(/\/venues\/\d+$/);
  return new URL(page.url()).pathname;
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
    await waitForHydration(page);
    await page.getByRole("link", { name: "Venues", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Venues", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "New venue" }).click();
    await expect(page.getByRole("heading", { name: "New venue" })).toBeVisible();
    // Wait for hydration before typing. React discards input sent before it attaches.
    await waitForHydration(page);

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
    // The guard must redirect before the loader renders the catalogue heading.
    await expect(page.getByRole("heading", { name: "Venues" })).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Your events" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Venues", exact: true })).toHaveCount(0);
  });

  test("sends a Coordinator from New venue back to the catalogue", async ({ page }) => {
    // `/venues/new` redirects to `/venues`. A Coordinator has `venue:read`, so the catalogue is
    // the correct fallback. Keep the fallback with its route, not in a shared layout.
    await signInAsSeeded(page, "coordinator.seed@example.com");

    await page.goto("/venues/new");
    await expect(page).toHaveURL(/\/venues$/);
    await expect(page.getByRole("heading", { name: "Venues", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New venue" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create venue" })).toHaveCount(0);
  });

  test("lets Venue Staff edit a venue and keeps the change across a reload", async ({ page }) => {
    await signInAsVenueStaff(page);
    // Use two ids. `getByText` matches substrings, so a new name that contains the old name would
    // make the removal check pass incorrectly.
    const original = `Playwright Original ${randomUUID().slice(0, 8)}`;
    const renamed = `Playwright Renamed ${randomUUID().slice(0, 8)}`;

    await createVenue(page, original);
    // Reload before editing. The create page already shows "Venue saved." A fresh load hides the
    // banner and reads the created row from the database, so the next check covers the edit.
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: original })).toBeVisible();

    await page.getByLabel("Venue name", { exact: true }).fill(renamed);
    await page.getByLabel("Maximum capacity", { exact: true }).fill("77");
    await page.getByRole("button", { name: "Save venue" }).click();

    await expect(page.getByText("Venue saved.")).toBeVisible();
    // The heading uses loader data, not typed values. It shows the new name only after
    // `router.invalidate()` runs the loader again. This catches a save path that copies the row
    // into component state.
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(page.getByLabel("Maximum capacity", { exact: true })).toHaveValue("77");
    await expect(page.getByText(original)).toHaveCount(0);
  });

  test("gives an Event Coordinator the record read-only", async ({ page }) => {
    await signInAsVenueStaff(page);
    const name = `Playwright Read-only ${randomUUID().slice(0, 8)}`;
    const detailPath = await createVenue(page, name);

    // Remove the staff cookie before signing in as another user. Better Auth checks CSRF only when
    // a request has a cookie, and this request has no `Origin` header. Without the cookie, sign-in
    // is refused. This also models changing users.
    await page.context().clearCookies();
    await signInAsSeeded(page, "coordinator.seed@example.com");
    await page.goto(detailPath);

    // This user may view the venue. Its values appear as text, not input values, in the read-only
    // list.
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText(CREATED_LOCATION)).toBeVisible();
    await expect(page.getByText("25", { exact: true })).toBeVisible();
    // Show layout labels, not the enum keys stored in the database.
    await expect(page.getByText("Theatre", { exact: true })).toBeVisible();

    // This user may not edit. Show no submit button or form controls.
    await expect(page.getByRole("button", { name: "Save venue" })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
});
