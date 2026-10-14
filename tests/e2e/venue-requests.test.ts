// oxlint-disable node/no-process-env
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";

import * as schema from "../../src/db/schema";
import { DEFAULT_OPERATING_HOURS } from "../../src/features/venues/schema";
import { waitForHydration } from "./hydration";
import { waitForEmail } from "./mailpit";
import { registerAccount } from "./register";

const password = "VenueRequest123!";
let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});
test.afterAll(async () => {
  await pool.end();
});

/** Create an Organiser, venue, and submitted event for this run's Coordinator. Add each id to
 * `cleanup` before writing its row, so cleanup still knows about it if a later write fails. This
 * follows the pattern in `coordination.test.ts`.
 */
async function seedFixture(
  coordinatorId: string,
  cleanup: { userIds: string[]; venueIds: number[] }
) {
  const organiserId = randomUUID();
  cleanup.userIds.push(organiserId);
  await database.insert(schema.user).values({
    id: organiserId,
    name: "Venue Request Organiser",
    email: `${organiserId}@example.invalid`,
    role: "event_organiser",
  });

  const venueName = `PTR-31 Hall ${randomUUID()}`;
  const [venue] = await database
    .insert(schema.venues)
    .values({
      name: venueName,
      location: "Request Wing",
      maxCapacity: 120,
      operatingHours: DEFAULT_OPERATING_HOURS,
    })
    .returning({ id: schema.venues.id });
  cleanup.venueIds.push(venue.id);

  const eventName = `PTR-31 Event ${randomUUID()}`;
  const [event] = await database
    .insert(schema.eventRequests)
    .values({
      organiserId,
      eventName,
      status: "submitted",
      submittedAt: new Date(),
      assignedCoordinatorId: coordinatorId,
      assignedAt: new Date(),
      proposedDates: [{ start: "2027-05-10T09:00", end: "2027-05-10T17:00" }],
      expectedAttendance: 60,
    })
    .returning({ id: schema.eventRequests.id });

  return { venueId: venue.id, venueName, eventId: event.id, eventName };
}

/** PTR-31: test the venue request panel, queued row, Venue Staff notification, and withdrawal.
 * This file owns its fixtures and does not change the seed's demo request.
 */
test("[PTR-31] a Coordinator requests a venue, Venue Staff are notified, and the request is withdrawn", async ({
  page,
}) => {
  const cleanup = { userIds: [] as string[], venueIds: [] as number[] };

  try {
    const coordinator = await registerAccount(database, page, {
      role: "event_coordinator",
      name: "Venue Request Coordinator",
      password,
    });
    cleanup.userIds.push(coordinator.id);
    const fixture = await seedFixture(coordinator.id, cleanup);

    await page.goto(`/venues/${fixture.venueId}?eventId=${fixture.eventId}`);
    await waitForHydration(page);

    await expect(page.getByRole("heading", { name: "Request this venue" })).toBeVisible();
    await expect(page.getByLabel("Date (required)", { exact: true })).toHaveValue("2027-05-10");
    await expect(page.getByLabel("Start time (required)", { exact: true })).toHaveValue("09:00");
    await expect(page.getByLabel("End time (required)", { exact: true })).toHaveValue("17:00");

    await page.getByLabel("End time (required)", { exact: true }).fill("15:30");
    await page.getByRole("button", { name: "Send booking request" }).click();

    // The panel reads loader data, so the pending request joins the list above the form. Focus
    // moves to the list heading so a screen reader hears the new row.
    const listHeading = page.getByRole("heading", { name: `Requests for ${fixture.eventName}` });
    const list = page.getByRole("list", { name: `Requests for ${fixture.eventName}` });
    await expect(listHeading).toBeFocused();
    await expect(list.getByText(/10 May 2027, 09:00 – 15:30/)).toBeVisible();
    await expect(list.getByText("Pending", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Request another time" })).toBeVisible();

    const createdRows = await database
      .select()
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.eventId, fixture.eventId));
    expect(createdRows).toHaveLength(1);
    const [created] = createdRows;
    expect(created).toMatchObject({
      venueId: fixture.venueId,
      startsAt: "2027-05-10 09:00:00",
      endsAt: "2027-05-10 15:30:00",
      status: "pending",
      assignedStaffId: null,
    });

    // AC4: notify every Venue Staff member. The seeded user represents this role.
    const email = await waitForEmail(
      "venue.staff.seed@example.com",
      `Venue booking requested: ${fixture.venueName}`
    );
    expect(email).toContain("10 May 2027");
    expect(email).toContain("09:00");
    expect(email).toContain("15:30");
    // Do not show the event name in the Venue Staff notification.
    expect(email).not.toContain(fixture.eventName);

    await page
      .getByRole("button", { name: "Withdraw request for 10 May 2027, 09:00 – 15:30" })
      .click();
    await expect(page.getByRole("alertdialog")).toContainText(
      `${fixture.venueName} on 10 May 2027, 09:00 – 15:30`
    );
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: "Request this venue" })).toBeVisible();
    await expect(listHeading).toBeFocused();
    await expect(list).toHaveCount(0);

    const [withdrawn] = await database
      .select()
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, created.id));
    expect(withdrawn.status).toBe("withdrawn");
  } finally {
    // Deleting the users removes the event and venue request by cascade. Then delete the venue.
    if (cleanup.userIds.length > 0) {
      await database.delete(schema.user).where(inArray(schema.user.id, cleanup.userIds));
    }
    if (cleanup.venueIds.length > 0) {
      await database.delete(schema.venues).where(inArray(schema.venues.id, cleanup.venueIds));
    }
  }
});

/** PTR-138 AC1/AC5: a second request for another venue lands on the same event, and the event
 * page lists both entries with their states. The venue page panel lists the event's requests at
 * that venue only, so the second venue starts with an empty list.
 */
test("[PTR-138] a Coordinator requests a second venue for the same event and the event page lists both", async ({
  page,
}) => {
  const cleanup = { userIds: [] as string[], venueIds: [] as number[] };

  try {
    const coordinator = await registerAccount(database, page, {
      role: "event_coordinator",
      name: "Second Venue Coordinator",
      password,
    });
    cleanup.userIds.push(coordinator.id);
    const fixture = await seedFixture(coordinator.id, cleanup);

    const secondVenueName = `PTR-138 Hall ${randomUUID()}`;
    const [secondVenue] = await database
      .insert(schema.venues)
      .values({
        name: secondVenueName,
        location: "Request Wing",
        maxCapacity: 80,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    cleanup.venueIds.push(secondVenue.id);

    await page.goto(`/venues/${fixture.venueId}?eventId=${fixture.eventId}`);
    await waitForHydration(page);
    await page.getByLabel("End time (required)", { exact: true }).fill("12:00");
    await page.getByRole("button", { name: "Send booking request" }).click();
    await expect(page.getByRole("heading", { name: "Request another time" })).toBeVisible();

    await page.goto(`/venues/${secondVenue.id}?eventId=${fixture.eventId}`);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "Request this venue" })).toBeVisible();
    await page.getByLabel("Start time (required)", { exact: true }).fill("13:00");
    await page.getByLabel("End time (required)", { exact: true }).fill("15:00");
    await page.getByRole("button", { name: "Send booking request" }).click();
    await expect(page.getByRole("heading", { name: "Request another time" })).toBeVisible();

    const rows = await database
      .select()
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.eventId, fixture.eventId));
    expect(rows).toHaveLength(2);
    const statusByVenue = new Map(rows.map(row => [row.venueId, row.status]));
    expect(statusByVenue.get(fixture.venueId)).toBe("pending");
    expect(statusByVenue.get(secondVenue.id)).toBe("pending");

    await page.goto(`/events/${fixture.eventId}`);
    await waitForHydration(page);
    const venue = page.locator("section#venue");
    await expect(venue.getByText(fixture.venueName)).toBeVisible();
    await expect(venue.getByText(secondVenueName)).toBeVisible();
    await expect(venue.getByText("Pending", { exact: true })).toHaveCount(2);
  } finally {
    if (cleanup.userIds.length > 0) {
      await database.delete(schema.user).where(inArray(schema.user.id, cleanup.userIds));
    }
    if (cleanup.venueIds.length > 0) {
      await database.delete(schema.venues).where(inArray(schema.venues.id, cleanup.venueIds));
    }
  }
});

/** PTR-138 AC4: one event books two sessions at one venue. The list shows both pending requests
 * above the form, and a window that overlaps one of them is refused with its window and state.
 */
test("[PTR-138] a Coordinator requests two sessions at one venue and an overlapping window is refused", async ({
  page,
}) => {
  const cleanup = { userIds: [] as string[], venueIds: [] as number[] };

  try {
    const coordinator = await registerAccount(database, page, {
      role: "event_coordinator",
      name: "Two Sessions Coordinator",
      password,
    });
    cleanup.userIds.push(coordinator.id);
    const fixture = await seedFixture(coordinator.id, cleanup);

    await page.goto(`/venues/${fixture.venueId}?eventId=${fixture.eventId}`);
    await waitForHydration(page);
    await page.getByLabel("End time (required)", { exact: true }).fill("11:00");
    await page.getByRole("button", { name: "Send booking request" }).click();
    const list = page.getByRole("list", { name: `Requests for ${fixture.eventName}` });
    await expect(list.getByRole("listitem")).toHaveCount(1);

    // The form stays open below the list for the second session.
    await expect(page.getByRole("heading", { name: "Request another time" })).toBeVisible();
    await page.getByLabel("Start time (required)", { exact: true }).fill("14:00");
    await page.getByLabel("End time (required)", { exact: true }).fill("16:00");
    await page.getByRole("button", { name: "Send booking request" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("listitem").nth(0)).toContainText("10 May 2027, 09:00 – 11:00");
    await expect(list.getByRole("listitem").nth(1)).toContainText("10 May 2027, 14:00 – 16:00");

    await page.getByLabel("Start time (required)", { exact: true }).fill("10:30");
    await page.getByLabel("End time (required)", { exact: true }).fill("12:00");
    await page.getByRole("button", { name: "Send booking request" }).click();
    const panel = page.getByRole("region", { name: `Requests for ${fixture.eventName}` });
    await expect(panel.getByRole("alert")).toHaveText(
      `This window overlaps this event's pending request for ${fixture.venueName} on 10 May 2027, 09:00 – 11:00.`
    );
    await expect(list.getByRole("listitem")).toHaveCount(2);

    const rows = await database
      .select({ status: schema.venueRequests.status })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.eventId, fixture.eventId));
    expect(rows).toEqual([{ status: "pending" }, { status: "pending" }]);
  } finally {
    if (cleanup.userIds.length > 0) {
      await database.delete(schema.user).where(inArray(schema.user.id, cleanup.userIds));
    }
    if (cleanup.venueIds.length > 0) {
      await database.delete(schema.venues).where(inArray(schema.venues.id, cleanup.venueIds));
    }
  }
});
