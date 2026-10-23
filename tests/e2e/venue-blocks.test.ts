import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForHydration } from "./hydration";
import { signInAsStaff } from "./staff-auth";

/**
 * The first Monday at least a week from now, as `YYYY-MM-DD`. New venues open Monday to Friday,
 * so the calendar shows hours. The lead keeps the day in the future in venue local time too, and
 * a block cannot start on a past day.
 */
function futureMonday(): string {
  const date = new Date(Date.now() + 7 * 86_400_000);
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7));
  return date.toISOString().slice(0, 10);
}

const START_DATE = futureMonday();
const START_TIME = "09:00";
const REASON = "Playwright open-ended works";

/** Create a venue through the form and return its id. Each test creates its own row to
 * avoid races on the shared seed venues.
 */
async function createVenue(page: Page, name: string): Promise<number> {
  await page.goto("/venues/new");
  // Wait for hydration before typing. React discards input sent before it attaches.
  await waitForHydration(page);

  await page.getByLabel("Venue name", { exact: true }).fill(name);
  await page.getByLabel("Location", { exact: true }).fill("Level 9, Playwright Wing");
  await page.getByLabel("Maximum capacity", { exact: true }).fill("25");
  await page.getByLabel("Facilities (optional)", { exact: true }).fill("Projector, Whiteboard");
  await page.getByRole("checkbox", { name: "Theatre" }).click();
  await page.getByRole("button", { name: "Create venue" }).click();

  await expect(page).toHaveURL(/\/venues\/\d+$/);
  return Number(new URL(page.url()).pathname.split("/").pop());
}

test("[PTR-136] venue staff records an open-ended block and lifts it", async ({ page }) => {
  await signInAsStaff(page, "venue_staff");
  const name = `Playwright Block Hall ${randomUUID().slice(0, 8)}`;
  const venueId = await createVenue(page, name);

  await page.goto(
    `/venues/availability?venueId=${venueId}&startDate=${START_DATE}&endDate=${START_DATE}`
  );
  const results = page.getByRole("region", { name: "Availability results" });
  await expect(results.getByRole("heading", { name, exact: true })).toBeVisible();

  // The dialog leaves the end empty, so submitting records an open-ended block.
  await results.getByRole("button", { name: "Block venue" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Date", { exact: true }).fill(START_DATE);
  await dialog.getByLabel("Start time", { exact: true }).fill(START_TIME);
  await dialog.getByLabel("Reason for block", { exact: true }).fill(REASON);
  await dialog.getByRole("button", { name: "Record block" }).click();

  await expect(results.getByText("Unavailable / blocked", { exact: true })).toBeVisible();
  await expect(results.getByText(REASON, { exact: true })).toBeVisible();
  await expect(results.getByText(/until lifted/)).toBeVisible();

  await results.getByRole("button", { name: "Lift venue block" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm lift" }).click();

  await expect(results.getByText("Unavailable / blocked", { exact: true })).toHaveCount(0);
  await expect(results.getByText(REASON, { exact: true })).toHaveCount(0);
});
