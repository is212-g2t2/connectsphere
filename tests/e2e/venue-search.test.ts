import { expect, test } from "@playwright/test";

import { DEMO_EVENT_NAME } from "../../scripts/seed";
import { waitForHydration } from "./hydration";
import { signInAsStaff } from "./staff-auth";
import { seededBlockDate } from "./venue-fixtures";

test("[PTR-29][AC1][AC2][AC3] a Coordinator filters the live venue catalogue", async ({ page }) => {
  await signInAsStaff(page, "event_coordinator");
  await page.goto("/venues");
  await waitForHydration(page);

  await Promise.all(
    [
      "Date",
      "End date",
      "Start time",
      "End time",
      "Expected attendance",
      "Location",
      "Minimum capacity",
      "Accessibility features",
      "Supported layout",
      "Required facilities",
    ].map(label => expect(page.getByLabel(label, { exact: true })).toBeVisible())
  );

  await page.getByLabel("Expected attendance", { exact: true }).fill("100");
  await page.getByLabel("Location", { exact: true }).fill("Marina Centre");
  await page.getByLabel("Minimum capacity", { exact: true }).fill("100");
  await page.getByLabel("Accessibility features", { exact: true }).fill("Step-free access");
  await page.getByLabel("Supported layout", { exact: true }).fill("theatre");
  await page.getByLabel("Required facilities", { exact: true }).fill("Projector, PA system");
  await page.getByRole("button", { name: "Search venues", exact: true }).click();

  const results = page.getByRole("region", { name: "Venue results" });
  await expect(results.getByRole("link", { name: "Harbour Hall", exact: true })).toBeVisible();
  await expect(results.getByText("Projector, PA system", { exact: false })).toBeVisible();
  await expect(results.getByRole("link", { name: "Seminar Room 2A", exact: true })).toHaveCount(0);
});

test("[PTR-29][AC4] an unavailable date and time renders an explicit empty result", async ({
  page,
}) => {
  await signInAsStaff(page, "event_coordinator");
  await page.goto("/venues");
  await waitForHydration(page);
  const blockedDate = await seededBlockDate("Harbour Hall");
  await page.getByLabel("Date", { exact: true }).fill(blockedDate);
  await page.getByLabel("End date", { exact: true }).fill(blockedDate);
  await page.getByLabel("Start time", { exact: true }).fill("10:00");
  await page.getByLabel("End time", { exact: true }).fill("12:00");
  await page.getByLabel("Expected attendance", { exact: true }).fill("100");
  await page.getByLabel("Location", { exact: true }).fill("Marina Centre");
  await page.getByLabel("Accessibility features", { exact: true }).fill("Step-free access");
  await page.getByLabel("Supported layout", { exact: true }).fill("theatre");
  // Catering prep area isolates Harbour Hall. Other Marina Centre venues match the looser
  // filters, so the blocked date alone would still return rows after the seed expansion.
  await page
    .getByLabel("Required facilities", { exact: true })
    .fill("Projector, PA system, Catering prep area");
  await page.getByRole("button", { name: "Search venues", exact: true }).click();

  await expect(page.getByText("No venue meets every requirement.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("[PTR-29][AC5] search launched from an event opens with its requirements prefilled", async ({
  page,
}) => {
  await signInAsStaff(page, "event_coordinator");
  await page.goto("/dashboard");
  await waitForHydration(page);
  // Dashboard cards link to the event page. Open search from the venue section.
  await page.getByRole("link", { name: DEMO_EVENT_NAME, exact: true }).click();
  await expect(page).toHaveURL(/\/events\/\d+/);
  await waitForHydration(page);
  await page
    .locator("section#venue")
    .getByRole("link", { name: "Find venues for this event", exact: true })
    .click();

  await expect(page.getByText(`Prefilled from ${DEMO_EVENT_NAME}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Date", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("End date", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("Expected attendance", { exact: true })).toHaveValue("120");
  await expect(page.getByLabel("Accessibility features", { exact: true })).toHaveValue(
    "Step-free access and hearing loop"
  );
  await expect(page.getByLabel("Supported layout", { exact: true })).toHaveValue("Theatre seating");
  await expect(page.getByLabel("Required facilities", { exact: true })).toHaveValue(
    "Projector, PA system"
  );
  // Check that the demo request matches Harbour Hall, not only that the fields are populated.
  const results = page.getByRole("region", { name: "Venue results" });
  await expect(results.getByRole("link", { name: "Harbour Hall", exact: true })).toBeVisible();
});

test("[PTR-30][AC2][AC3][AC5] the venues that do not suit the event say why", async ({ page }) => {
  await signInAsStaff(page, "event_coordinator");
  await page.goto("/dashboard");
  await waitForHydration(page);
  await page.getByRole("link", { name: DEMO_EVENT_NAME, exact: true }).click();
  await expect(page).toHaveURL(/\/events\/\d+/);
  await waitForHydration(page);
  await page
    .locator("section#venue")
    .getByRole("link", { name: "Find venues for this event", exact: true })
    .click();
  await expect(page.getByText(`Prefilled from ${DEMO_EVENT_NAME}`, { exact: true })).toBeVisible();

  const unsuitable = page.getByRole("region", { name: "Not suitable" });
  await expect(unsuitable).toBeVisible();
  // Seminar Room 2A has 40 seats and the demo event needs 120. Check that the message states this.
  const seminarRow = unsuitable.getByRole("row", { name: /Seminar Room 2A/ });
  await expect(seminarRow).toContainText("Holds 40; 120 needed");
  // AC6: reading a verdict does not book or block the venue. The user can still open the calendar action.
  await expect(unsuitable.getByText(/books or blocks nothing/)).toBeVisible();
});
