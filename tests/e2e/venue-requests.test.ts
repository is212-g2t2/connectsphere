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

    // The panel reads loader data, so the pending request replaces the form in place.
    await expect(page.getByRole("heading", { name: "Venue request" })).toBeVisible();
    await expect(page.getByText(/10 May 2027, 09:00 – 15:30/)).toBeVisible();

    const [created] = await database
      .select()
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.eventId, fixture.eventId));
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

    await page.getByRole("button", { name: "Withdraw request" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("heading", { name: "Request this venue" })).toBeVisible();

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
