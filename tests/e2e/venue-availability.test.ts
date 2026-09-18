// oxlint-disable node/no-process-env
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { SEED_STAFF_PASSWORD } from "../../scripts/seed";
import { waitForHydration } from "./hydration";

const STAFF_ACCOUNTS = {
  event_coordinator: "coordinator.seed@example.com",
  venue_staff: "venue.staff.seed@example.com",
  technical_support_staff: "tech.support.seed@example.com",
} as const;

type StaffRole = keyof typeof STAFF_ACCOUNTS;

async function signInAsStaff(page: Page, role: StaffRole) {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: STAFF_ACCOUNTS[role], password: SEED_STAFF_PASSWORD },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function signUpAsExternal(page: Page, role: "attendee" | "event_organiser") {
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: {
      name: `${role} PTR-28 test account`,
      email: `ptr-28-${role}-${randomUUID()}@example.invalid`,
      password: "Venue-Read123!",
      role,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function selectLiveRange(page: Page, venueName: string, start: string, end = start) {
  // The page is server-rendered and then hydrated; values typed before React is listening are
  // wiped, or the form submits natively. Wait for hydration the way `dashboard.test.ts` does.
  await waitForHydration(page);
  await page.locator("#availability-venue").click();
  await expect(page.getByRole("option", { name: venueName, exact: true })).toHaveCount(1);
  await page.getByRole("option", { name: venueName, exact: true }).click();
  await page.getByLabel("Start date", { exact: true }).fill(start);
  await page.getByLabel("End date", { exact: true }).fill(end);
  await page.getByRole("button", { name: "Show availability" }).click();
}

async function seededBlockDate(venueName: string): Promise<string> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [period] = await drizzle(pool, { schema })
      .select({ startsAt: schema.venueUnavailability.startsAt })
      .from(schema.venueUnavailability)
      .innerJoin(schema.venues, eq(schema.venueUnavailability.venueId, schema.venues.id))
      .where(eq(schema.venues.name, venueName))
      .orderBy(asc(schema.venueUnavailability.startsAt))
      .limit(1);
    if (!period) throw new Error(`No seeded block found for ${venueName}`);
    return period.startsAt.slice(0, 10);
  } finally {
    await pool.end();
  }
}

test("[PTR-28-TC01-LIVE][AC1] coordinator loads seeded venues and renders a schedule", async ({
  page,
}) => {
  await signInAsStaff(page, "event_coordinator");
  await page.goto("/venues/availability");
  await expect(page.getByRole("heading", { name: "Venue calendar", exact: true })).toBeVisible();
  // Derived from the seed like its sibling: the seeded dates are relative to seed time, so a
  // literal date would silently drift out from under the venue it was chosen for.
  await selectLiveRange(page, "Harbour Hall", await seededBlockDate("Harbour Hall"));

  const results = page.getByRole("region", { name: "Availability results" });
  await expect(results.getByRole("heading", { name: "Harbour Hall", exact: true })).toBeVisible();
  await expect(results.getByText("Times shown in venue local time", { exact: true })).toBeVisible();
});

test("[PTR-28-TC11-LIVE][PTR-28-TC12-LIVE][AC2][AC4] venue staff sees recorded unavailability", async ({
  page,
}) => {
  await signInAsStaff(page, "venue_staff");
  await page.goto("/venues/availability");
  await selectLiveRange(page, "Seminar Room 2A", await seededBlockDate("Seminar Room 2A"));

  const results = page.getByRole("region", { name: "Availability results" });
  await expect(
    results.getByRole("heading", { name: "Seminar Room 2A", exact: true })
  ).toBeVisible();
  await expect(results.getByText("Unavailable / blocked", { exact: true })).toBeVisible();
});

test("[PTR-28-TC02-LIVE][AC1] technical support staff has read-only calendar access", async ({
  page,
}) => {
  await signInAsStaff(page, "technical_support_staff");
  await page.goto("/venues/availability");
  await expect(page.getByRole("heading", { name: "Venue calendar", exact: true })).toBeVisible();
  await expect(page.getByLabel("Venue", { exact: true })).toBeVisible();
});

test("[AC1] a venue id no row holds answers the router's not-found page", async ({ page }) => {
  await signInAsStaff(page, "venue_staff");
  await page.goto("/venues/availability?venueId=999999&startDate=2027-03-15&endDate=2027-03-16");

  await expect(page.getByRole("heading", { name: "404 - Not Found", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Availability results" })).toHaveCount(0);
});

test.describe("External roles", () => {
  test("[PTR-28-TC13][AC5] organiser is refused the page", async ({ page }) => {
    await signUpAsExternal(page, "event_organiser");
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Venue calendar", exact: true })).toHaveCount(0);
    await page.goto("/venues/availability");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByLabel("Venue", { exact: true })).toHaveCount(0);
  });
});

test("[PTR-28-TC18-A][AC5] redirects a signed-out visitor to login", async ({ page }) => {
  await page.goto("/venues/availability");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("region", { name: "Availability results" })).toHaveCount(0);
});
