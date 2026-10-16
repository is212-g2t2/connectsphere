// oxlint-disable node/no-process-env
//
// PTR-137: Venue Staff block a venue a confirmed event is booked at. The event goes back to
// planning, its Coordinator sees the suspended booking with the block's reason, releases it in
// favour of a replacement, and the lift leaves the release in place. Each test creates its own
// venue and event, so it runs in parallel with the other suites.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { DEFAULT_OPERATING_HOURS } from "../../src/features/venues/schema";
import { waitForHydration } from "./hydration";
import { signInWithSeedPassword } from "./staff-auth";

const COORDINATOR_EMAIL = "coordinator.seed@example.com";
const COORDINATOR_ID = "seed-coordinator-1";
const VENUE_STAFF_EMAIL = "venue.staff.seed@example.com";
const VENUE_STAFF_ID = "seed-venue-staff-1";
const ORGANISER_ID = "test-user-2";
// 2031-06-16 is a Monday. New venues open Monday to Friday, so the calendar shows hours.
const DATE = "2031-06-16";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;
const created: { eventId: number; venueId: number }[] = [];

test.beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in the Playwright process.");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});

test.afterEach(async () => {
  if (created.length > 0) {
    // Events cascade to their bookings, ledger rows and notifications; venues to their blocks.
    await database.delete(schema.eventRequests).where(
      inArray(
        schema.eventRequests.id,
        created.map(row => row.eventId)
      )
    );
    await database.delete(schema.venues).where(
      inArray(
        schema.venues.id,
        created.map(row => row.venueId)
      )
    );
    created.length = 0;
  }
});

test.afterAll(async () => {
  await pool?.end();
});

/** A confirmed event booked at its own venue, with the booking's ledger row, as approval writes it. */
async function confirmedEventAtNewVenue() {
  const name = `PTR-137 E2E ${randomUUID().slice(0, 8)}`;
  const venueName = `PTR-137 Hall ${randomUUID().slice(0, 8)}`;
  const [venue] = await database
    .insert(schema.venues)
    .values({
      name: venueName,
      location: "PTR-137 Wing",
      maxCapacity: 120,
      operatingHours: DEFAULT_OPERATING_HOURS,
    })
    .returning({ id: schema.venues.id });
  // Registered before the event exists, so a failed insert below still cleans the venue up.
  const cleanup = { eventId: 0, venueId: venue.id };
  created.push(cleanup);
  const [event] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId: ORGANISER_ID,
      status: "confirmed",
      submittedAt: new Date(),
      assignedCoordinatorId: COORDINATOR_ID,
      assignedAt: new Date(),
      decidedByCoordinatorId: COORDINATOR_ID,
      decidedByCoordinatorName: "Seed Coordinator",
      decidedAt: new Date(),
      confirmedById: COORDINATOR_ID,
      confirmedByName: "Seed Coordinator",
      confirmedAt: new Date(),
      eventName: name,
      purpose: "Re-plan",
      proposedDates: [{ start: `${DATE}T10:00`, end: `${DATE}T12:00` }],
      expectedAttendance: 40,
      eventType: "Conference",
    })
    .returning({ id: schema.eventRequests.id });
  cleanup.eventId = event.id;
  const bookingId = randomUUID();
  await database.insert(schema.venueRequests).values({
    id: bookingId,
    eventId: event.id,
    venueId: venue.id,
    requestedById: COORDINATOR_ID,
    assignedStaffId: VENUE_STAFF_ID,
    startsAt: `${DATE} 10:00:00`,
    endsAt: `${DATE} 12:00:00`,
    status: "approved",
  });
  await database.insert(schema.venueOccupancy).values({
    venueId: venue.id,
    eventId: event.id,
    venueRequestId: bookingId,
    startsAt: `${DATE} 10:00:00`,
    endsAt: `${DATE} 12:00:00`,
  });
  return { eventId: event.id, venueId: venue.id, name, venueName, bookingId };
}

async function openAs(browser: Browser, email: string, path: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInWithSeedPassword(page, email);
  await page.goto(path);
  await waitForHydration(page);
  return page;
}

const eventStatus = async (id: number) =>
  (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0]
    .status;

test("a block reverts the confirmed event, flags the booking for the Coordinator, and the Coordinator's release survives the lift (AC1, AC2, AC4)", async ({
  browser,
}) => {
  const { eventId, venueId, name, venueName, bookingId } = await confirmedEventAtNewVenue();

  // Venue Staff block the venue over the booking from the calendar.
  const staff = await openAs(
    browser,
    VENUE_STAFF_EMAIL,
    `/venues/availability?venueId=${venueId}&startDate=${DATE}&endDate=${DATE}`
  );
  const results = staff.getByRole("region", { name: "Availability results" });
  await expect(results.getByRole("heading", { name: venueName, exact: true })).toBeVisible();
  await results.getByRole("button", { name: "Block venue" }).click();
  const dialog = staff.getByRole("dialog");
  await dialog.getByLabel("Date", { exact: true }).fill(DATE);
  await dialog.getByLabel("Start time", { exact: true }).fill("09:00");
  await dialog.getByLabel("Reason for block", { exact: true }).fill("Flooding in the hall");
  await dialog.getByRole("button", { name: "Record block" }).click();
  await expect(results.getByText("Flooding in the hall", { exact: true })).toBeVisible();
  expect(await eventStatus(eventId)).toBe("planning");

  // The Coordinator sees the flag on the list and on the event, with the reason.
  const coordinator = await openAs(browser, COORDINATOR_EMAIL, "/coordination");
  await expect(
    coordinator.getByRole("listitem").filter({ hasText: name }).getByText("Venue blocked")
  ).toBeVisible();
  await coordinator.goto(`/events/${eventId}`);
  await waitForHydration(coordinator);
  const flag = coordinator.getByRole("region", { name: "Venue blocked" });
  await expect(flag.getByText("Booking suspended")).toBeVisible();
  await expect(flag.getByText("Flooding in the hall")).toBeVisible();
  await expect(flag.getByRole("link", { name: "Find a replacement venue" })).toBeVisible();

  // The Coordinator releases the suspended booking in favour of a replacement.
  await flag.getByRole("button", { name: `Release this booking: ${venueName}` }).click();
  await coordinator
    .getByRole("alertdialog")
    .getByRole("button", { name: "Release booking" })
    .click();
  await expect(
    coordinator.getByText("Booking released. The Venue Staff who settled it will be notified.")
  ).toBeVisible();
  await expect(coordinator.getByRole("region", { name: "Venue blocked" })).toHaveCount(0);
  const [released] = await database
    .select({ status: schema.venueRequests.status, reason: schema.venueRequests.releaseReason })
    .from(schema.venueRequests)
    .where(eq(schema.venueRequests.id, bookingId));
  expect(released.status).toBe("released");
  expect(released.reason).toContain("Flooding in the hall");

  // The lift does not bring the released booking back.
  await results.getByRole("button", { name: "Lift venue block" }).click();
  await staff.getByRole("alertdialog").getByRole("button", { name: "Confirm lift" }).click();
  await expect(results.getByText("Flooding in the hall", { exact: true })).toHaveCount(0);
  const [afterLift] = await database
    .select({ status: schema.venueRequests.status })
    .from(schema.venueRequests)
    .where(eq(schema.venueRequests.id, bookingId));
  expect(afterLift.status).toBe("released");
  expect(await eventStatus(eventId)).toBe("planning");
});
