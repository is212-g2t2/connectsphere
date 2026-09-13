import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEED_STAFF_PASSWORD } from "../../scripts/seed";

// Sign-up can only mint external roles, so the internal accounts these tests sign in as come
// from the seed that `global-setup.ts` runs once before the suite.

async function signInAsSeeded(page: Page, email: string): Promise<void> {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password: SEED_STAFF_PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

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

/** The location the helper below records, so a test can assert on what it filled in. */
const CREATED_LOCATION = "Level 4, Playwright Wing";

/**
 * Records a venue through the form and leaves the page on its detail route, returning that
 * route's path. The seed's demo venues are shared mutable state, so a test that edits or reads
 * back a specific record brings its own row rather than racing every other run for one of those.
 * The path is read only once `?saved=true` has been stripped: the detail route drops that param
 * in an effect, so until then neither the URL nor a reload of it is stable.
 */
async function createVenue(page: Page, name: string): Promise<string> {
  await page.goto("/venues/new");
  // Controlled inputs: typing before hydration completes is thrown away when React attaches.
  await page.waitForLoadState("networkidle");

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

  test("lets Venue Staff edit a venue and keeps the change across a reload", async ({ page }) => {
    await signInAsVenueStaff(page);
    // Two independent ids: `getByText` matches substrings, so a renamed venue whose name
    // contained the original one would make the "old value is gone" check below unfalsifiable.
    const original = `Playwright Original ${randomUUID().slice(0, 8)}`;
    const renamed = `Playwright Renamed ${randomUUID().slice(0, 8)}`;

    await createVenue(page, original);
    // Reloaded before touching anything: creating arrives with "Venue saved." already on screen,
    // and the same assertion after the edit has to be about the edit. The fresh load starts the
    // banner hidden, and shows the created row coming back from the database on its own.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: original })).toBeVisible();

    await page.getByLabel("Venue name", { exact: true }).fill(renamed);
    await page.getByLabel("Maximum capacity", { exact: true }).fill("77");
    await page.getByRole("button", { name: "Save venue" }).click();

    await expect(page.getByText("Venue saved.")).toBeVisible();
    // The heading renders loader data, never the values that were typed, so it only reads the
    // new name once `router.invalidate()` has re-run the loader — this is the assertion that
    // fails if the save path goes back to mirroring the row in component state.
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

    // Dropped rather than overwritten: Better Auth only CSRF-checks a request that carries a
    // cookie, and the request context sends no `Origin` header for it to accept, so signing in
    // over the staff session is refused. Clearing it is also what changing person really is.
    await page.context().clearCookies();
    await signInAsSeeded(page, "coordinator.seed@example.com");
    await page.goto(detailPath);

    // May view. In the read-only list the stored values are text rather than input values, so
    // `getByText` finding them is itself the evidence that this is not the form.
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText(CREATED_LOCATION)).toBeVisible();
    await expect(page.getByText("25", { exact: true })).toBeVisible();
    // Layouts read as their labels here, never as the enum keys the column stores.
    await expect(page.getByText("Theatre", { exact: true })).toBeVisible();

    // May not edit: no submit, and none of the three kinds of control the form is built from.
    await expect(page.getByRole("button", { name: "Save venue" })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
});
