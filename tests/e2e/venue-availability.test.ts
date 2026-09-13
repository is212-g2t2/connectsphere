// oxlint-disable node/no-process-env
import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema";
import type { Role } from "#/features/auth/schema/role";
import { provisionPtr28Account } from "../fixtures/ptr-28-auth";
import {
  createPtr28CalendarSource,
  createPtr28Fixture,
  PTR28_CLOCK,
  fixtureTime,
} from "../fixtures/ptr-28";

const test = base.extend<{ calendarRole: Role; calendarAccount: string }>({
  calendarRole: ["event_coordinator", { option: true }],
  calendarAccount: [
    async ({ context, calendarRole }, use) => {
      if (!process.env.DATABASE_URL)
        throw new Error("Set DATABASE_URL explicitly for PTR-28 browser fixtures");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const account = await provisionPtr28Account(drizzle(pool, { schema }), calendarRole);
      try {
        const response = await context.request.post("/api/auth/sign-in/email", {
          data: { email: account.email, password: account.password },
        });
        expect(response.status()).toBe(200);
        await use(account.id);
      } finally {
        await account.remove();
        await pool.end();
      }
    },
    { auto: true },
  ],
});

async function mockCalendar(page: Page, fixture = createPtr28Fixture()) {
  const source = createPtr28CalendarSource(fixture);
  await page.clock.setFixedTime(new Date(PTR28_CLOCK));
  await page.route("**/api/venue-availability/venues", route =>
    route.fulfill({ json: fixture.venues.map(({ id, name }) => ({ id, name })) })
  );
  await page.route("**/api/venue-availability?*", async route => {
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({
      json: await source.read({
        venueId: query.get("venueId") ?? "",
        startDate: query.get("startDate") ?? "",
        endDate: query.get("endDate") ?? "",
      }),
    });
  });
}

async function selectRange(page: Page, start = "2026-10-05", end = "2026-10-07", venue = "VA") {
  await page.getByLabel("Venue", { exact: true }).selectOption(venue);
  await page.getByLabel("Start date", { exact: true }).fill(start);
  await page.getByLabel("End date", { exact: true }).fill(end);
  await page.getByRole("button", { name: "Show availability" }).click();
}

async function selectLiveRange(page: Page, venueName: string, start: string, end = start) {
  const venue = page.getByLabel("Venue", { exact: true });
  await expect(venue.locator("option", { hasText: venueName })).toHaveCount(1);
  await venue.selectOption({ label: venueName });
  await expect(venue).toHaveValue(/^[1-9]\d*$/);
  await page.getByLabel("Start date", { exact: true }).fill(start);
  await page.getByLabel("End date", { exact: true }).fill(end);
  await page.getByRole("button", { name: "Show availability" }).click();
}

async function seededBlockDate(venueName: string): Promise<string> {
  if (!process.env.DATABASE_URL)
    throw new Error("Set DATABASE_URL explicitly for PTR-28 browser fixtures");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [period] = await drizzle(pool, { schema })
      .select({ startsAt: schema.venueUnavailability.startsAt })
      .from(schema.venueUnavailability)
      .innerJoin(schema.venues, eq(schema.venueUnavailability.venueId, schema.venues.id))
      .where(eq(schema.venues.name, venueName))
      .limit(1);

    if (!period) throw new Error(`No seeded block found for ${venueName}`);
    return period.startsAt.slice(0, 10);
  } finally {
    await pool.end();
  }
}

test("[PTR-28-TC01][AC1] coordinator opens the calendar from the dashboard (supplemental fixture data)", async ({
  page,
}) => {
  await mockCalendar(page);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Venue availability", exact: true }).click();
  await selectRange(page);
  const results = page.getByRole("region", { name: "Availability results" });
  await expect(results.getByRole("heading", { name: "Test Hall A" })).toBeVisible();
  await expect(results.getByRole("heading", { level: 3 })).toHaveCount(3);
});

test.describe("Venue Staff", () => {
  test.use({ calendarRole: "venue_staff" });
  test("[PTR-28-TC02][AC1] venue staff opens the calendar (supplemental fixture data)", async ({
    page,
  }) => {
    await mockCalendar(page);
    await page.goto("/venues/availability");
    await selectRange(page);
    await expect(
      page.getByRole("region", { name: "Availability results" }).getByText("10:00–12:00")
    ).toBeVisible();
  });

  test("[PTR-28-TC11-LIVE][PTR-28-TC12-LIVE][AC1][AC2][AC4] venue staff sees Seminar Room 2A recorded unavailability through the real endpoint", async ({
    page,
  }) => {
    await page.goto("/venues/availability");
    await selectLiveRange(page, "Seminar Room 2A", await seededBlockDate("Seminar Room 2A"));
    const results = page.getByRole("region", { name: "Availability results" });
    await expect(
      results.getByRole("heading", { name: "Seminar Room 2A", exact: true })
    ).toBeVisible();
    await expect(
      results.getByText("Times shown in venue local time", { exact: true })
    ).toBeVisible();
    await expect(results.getByText("09:00–18:00", { exact: true })).toBeVisible();
    await expect(results.getByText("Unavailable / blocked", { exact: true })).toBeVisible();
    await expect(results.getByText("Confirmed booking", { exact: true })).toHaveCount(0);
  });
});

test("[PTR-28-TC03][AC1] switches venues without retaining the old schedule (supplemental fixture data)", async ({
  page,
}) => {
  await mockCalendar(page);
  await page.goto("/venues/availability");
  await selectRange(page);
  await expect(page.getByRole("region", { name: "Availability results" })).toBeVisible();
  await selectRange(page, "2026-10-05", "2026-10-07", "VB");
  const results = page.getByRole("region", { name: "Availability results" });
  await expect(results.getByRole("heading", { name: "Test Hall B" })).toBeVisible();
  await expect(results.getByText("09:00–10:00")).toBeVisible();
  await expect(results.getByText("13:00–15:00")).toHaveCount(0);
});

test("[PTR-28-TC04][AC1] updates the date range (supplemental fixture data)", async ({ page }) => {
  await mockCalendar(page);
  await page.goto("/venues/availability");
  await selectRange(page);
  await expect(page.getByRole("region", { name: "Availability results" })).toBeVisible();
  await selectRange(page, "2026-10-12", "2026-10-12");
  const results = page.getByRole("region", { name: "Availability results" });
  await expect(results.getByRole("heading", { name: "Monday, 12 October 2026" })).toBeVisible();
  await expect(results.getByRole("heading", { level: 3 })).toHaveCount(1);
});

test("[PTR-28-TC05][AC2][PTR-28-TC06][AC3][PTR-28-TC11][AC4] displays exact periods and text states (supplemental fixture data)", async ({
  page,
}) => {
  const fixture = createPtr28Fixture();
  fixture.bookings[0].startsAt = fixtureTime(5, "10:15");
  fixture.bookings[0].endsAt = fixtureTime(5, "11:45");
  await mockCalendar(page, fixture);
  await page.goto("/venues/availability");
  await selectRange(page, "2026-10-05", "2026-10-05");
  const results = page.getByRole("region", { name: "Availability results" });
  await expect(results.getByText("10:15–11:45")).toBeVisible();
  await expect(results.getByText("Confirmed booking", { exact: true })).toBeVisible();
  await expect(results.getByText("Unavailable / blocked", { exact: true })).toBeVisible();
  await expect(results.getByText("Available", { exact: true }).first()).toBeVisible();
});

test.describe("Browser in a different timezone", () => {
  test.use({ timezoneId: "America/Los_Angeles" });
  test("[PTR-28-TC07][AC3][PTR-28-TC08] shows another event's overnight occupancy in the supplied venue timezone (supplemental fixture data)", async ({
    page,
  }) => {
    await mockCalendar(page);
    await page.goto("/venues/availability");
    await selectRange(page);
    const results = page.getByRole("region", { name: "Availability results" });
    await expect(results.getByText("14:00–16:00")).toBeVisible();
    await expect(results.getByText("23:00–24:00")).toBeVisible();
    await expect(results.getByText("00:00–01:00")).toBeVisible();
    await expect(results.getByText("Times shown in Asia/Singapore")).toBeVisible();
  });

  test("[PTR-28-TC16-LIVE][AC2] preserves Harbour Hall hours and closes its null Sunday in a different browser timezone", async ({
    page,
  }) => {
    await page.goto("/venues/availability");
    await selectLiveRange(page, "Harbour Hall", "2027-04-16", "2027-04-18");
    const results = page.getByRole("region", { name: "Availability results" });
    await expect(
      results.getByText("Times shown in venue local time", { exact: true })
    ).toBeVisible();
    await expect(
      results.getByRole("heading", { name: "Friday, 16 April 2027", exact: true })
    ).toBeVisible();
    await expect(results.getByText("08:00–23:00", { exact: true })).toBeVisible();
    const sunday = results
      .getByRole("heading", { name: "Sunday, 18 April 2027", exact: true })
      .locator("..");
    await expect(sunday).toBeVisible();
    await expect(
      sunday.getByText("No availability periods were returned for this date.", { exact: true })
    ).toBeVisible();
    await expect(results.getByText("Confirmed booking", { exact: true })).toHaveCount(0);
  });
});

test("[PTR-28-TC16][AC2] displays a successful empty schedule as an available day (supplemental fixture data)", async ({
  page,
}) => {
  const fixture = createPtr28Fixture();
  fixture.bookings = [];
  fixture.blocks = [];
  await mockCalendar(page, fixture);
  await page.goto("/venues/availability");
  await selectRange(page, "2026-10-05", "2026-10-05");
  const results = page.getByRole("region", { name: "Availability results" });
  await expect(results.getByText("00:00–24:00")).toBeVisible();
  await expect(results.getByText("Available", { exact: true })).toBeVisible();
});

test("[PTR-28-TC19][AC1][AC2] shows a failed request and retries successfully (supplemental fixture data)", async ({
  page,
}) => {
  await mockCalendar(page);
  await page.route(
    "**/api/venue-availability?*",
    route => route.fulfill({ status: 503, json: { error: "test failure" } }),
    { times: 1 }
  );
  await page.goto("/venues/availability");
  await selectRange(page);
  await expect(page.getByRole("alert")).toContainText("Availability could not be loaded");
  await expect(page.getByRole("region", { name: "Availability results" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry availability" }).click();
  await expect(page.getByRole("region", { name: "Availability results" })).toBeVisible();
});

test("[PTR-28-TC01-LIVE][AC1] coordinator loads seeded venues and selects one through the real endpoints", async ({
  page,
}) => {
  await page.goto("/venues/availability");
  await expect(
    page.getByRole("heading", { name: "Venue availability", exact: true })
  ).toBeVisible();
  await selectLiveRange(page, "Harbour Hall", "2027-04-16");
  const results = page.getByRole("region", { name: "Availability results" });
  await expect(results.getByRole("heading", { name: "Harbour Hall", exact: true })).toBeVisible();
  await expect(results.getByText("Times shown in venue local time", { exact: true })).toBeVisible();
  await expect(
    results.getByRole("heading", { name: "Friday, 16 April 2027", exact: true })
  ).toBeVisible();
  await expect(results.getByText("08:00–23:00", { exact: true })).toBeVisible();
  await expect(results.getByText("Confirmed booking", { exact: true })).toHaveCount(0);
});

for (const { variant, role } of [
  { variant: "A", role: "attendee" as const },
  { variant: "B", role: "event_organiser" as const },
]) {
  test.describe(`External role ${role}`, () => {
    test.use({ calendarRole: role });
    test(`[PTR-28-TC13-${variant}][AC5] refuses the page and hides the navigation link`, async ({
      page,
    }) => {
      await page.goto("/dashboard");
      await expect(page.getByRole("link", { name: "Venue availability", exact: true })).toHaveCount(
        0
      );
      await page.goto("/venues/availability");
      await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
      await expect(page.getByLabel("Venue", { exact: true })).toHaveCount(0);
    });
    test(`[PTR-28-TC14-${variant}][AC5] refuses both real HTTP endpoints before opening the page`, async ({
      context,
    }) => {
      await Promise.all(
        [
          "/api/venue-availability/venues",
          "/api/venue-availability?venueId=VA&startDate=2026-10-05&endDate=2026-10-07",
        ].map(async endpoint => {
          const response = await context.request.get(endpoint);
          expect(response.status()).toBe(403);
          expect(await response.json()).toEqual({ error: "Forbidden" });
        })
      );
    });
  });
}

base("[PTR-28-TC18-A][AC1][AC5] redirects a signed-out visitor to login", async ({ page }) => {
  await page.goto("/venues/availability");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("region", { name: "Availability results" })).toHaveCount(0);
});

base(
  "[PTR-28-TC18-B][AC1][AC5] returns 401 from both real HTTP endpoints without a session",
  async ({ request }) => {
    await Promise.all(
      [
        "/api/venue-availability/venues",
        "/api/venue-availability?venueId=VA&startDate=2026-10-05&endDate=2026-10-07",
      ].map(async endpoint => {
        const response = await request.get(endpoint);
        expect(response.status()).toBe(401);
        expect(await response.json()).toEqual({ error: "Unauthorized" });
      })
    );
  }
);
