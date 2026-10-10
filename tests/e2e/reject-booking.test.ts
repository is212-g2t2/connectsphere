// oxlint-disable node/no-process-env
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { DEFAULT_OPERATING_HOURS } from "../../src/features/venues/schema";
import { waitForHydration } from "./hydration";
import { signInAsStaff } from "./staff-auth";

// The seeded Coordinator the dashboard signs in as (`scripts/seed.ts`).
const SEED_COORDINATOR_ID = "seed-coordinator-1";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});

test.afterAll(async () => {
  await pool.end();
});

test("[PTR-34] Venue Staff reject with a reason and a suggestion, and the Coordinator sees both", async ({
  page,
}) => {
  const organiserId = randomUUID();
  const eventName = `PTR-34 Event ${randomUUID()}`;
  const venueName = `PTR-34 Requested Hall ${randomUUID()}`;
  const alternativeName = `PTR-34 Alternative Room ${randomUUID()}`;
  const requestId = randomUUID();
  const reason = `Closed for floor resurfacing ${randomUUID()}`;
  let venueIds: number[] = [];
  let eventId: number | undefined;

  try {
    await database.insert(schema.user).values({
      id: organiserId,
      name: "PTR-34 Browser Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });

    const venues = await database
      .insert(schema.venues)
      .values(
        [venueName, alternativeName].map(name => ({
          name,
          location: "PTR-34 Browser Wing",
          maxCapacity: 300,
          operatingHours: DEFAULT_OPERATING_HOURS,
        }))
      )
      .returning({ id: schema.venues.id });
    venueIds = venues.map(venue => venue.id);

    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId,
        eventName,
        status: "submitted",
        submittedAt: new Date("2037-06-01T00:00:00Z"),
        assignedCoordinatorId: SEED_COORDINATOR_ID,
        assignedAt: new Date("2037-06-01T00:00:00Z"),
        proposedDates: [{ start: "2037-10-13T09:00", end: "2037-10-13T12:00" }],
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;

    await database.insert(schema.venueRequests).values({
      id: requestId,
      eventId,
      venueId: venueIds[0],
      requestedById: SEED_COORDINATOR_ID,
      startsAt: "2037-10-13 09:00:00",
      endsAt: "2037-10-13 12:00:00",
    });

    await signInAsStaff(page, "venue_staff");
    await page.goto(`/events/${eventId}`);
    await waitForHydration(page);

    const decision = page.locator("section#decision");
    await expect(decision).toBeVisible();

    // AC1: a rejection without a reason is refused before anything is sent.
    await decision.getByRole("button", { name: "Reject request" }).click();
    await expect(page.getByText("Enter a reason to reject this request")).toBeVisible();
    expect(
      (
        await database
          .select()
          .from(schema.venueRequests)
          .where(eq(schema.venueRequests.id, requestId))
      )[0].status
    ).toBe("pending");

    // AC2: a reason plus a suggested venue, date and times.
    await page.getByLabel("Reason for rejection (required)").fill(reason);
    await page.getByLabel("Suggested venue").click();
    await page.getByRole("option", { name: alternativeName }).click();
    await page.getByLabel("Suggested date").fill("2037-10-14");
    await page.getByLabel("Suggested start time").fill("10:00");
    await page.getByLabel("Suggested end time").fill("13:30");
    await decision.getByRole("button", { name: "Reject request" }).click();

    await expect(page.getByText(`Booking rejected for ${venueName}.`)).toBeVisible();
    // The page refreshes in place: no navigation back to a queue, and the decision is gone.
    // The event page stays with the settled outcome; only the decision block drops out.
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
    await expect(page.locator("section#decision")).toHaveCount(0);

    const [row] = await database
      .select()
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, requestId));
    expect(row).toMatchObject({
      status: "rejected",
      rejectionReason: reason,
      suggestedVenueId: venueIds[1],
      suggestedDate: "2037-10-14",
      suggestedStartTime: "10:00:00",
      suggestedEndTime: "13:30:00",
    });

    // AC5: the decided request leaves the actionable queue: the decision block is gone
    // (asserted above) and the dashboard card is now the settled record linking to it.
    await page.goto("/dashboard");
    await waitForHydration(page);
    await page.getByRole("link", { name: venueName, exact: true }).click();
    await waitForHydration(page);
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
    const outcome = page.locator("section#request");
    await expect(outcome.getByText("Request declined.")).toBeVisible();
    await expect(outcome.getByText(reason)).toBeVisible();
    await expect(outcome.getByText(`${alternativeName}, 14 Oct 2037, 10:00–13:30`)).toBeVisible();
    // AC3: the requesting Coordinator finds the rejection on the event page, with reason and
    // suggestion. Better Auth refuses a second sign-in that carries the first session's cookie
    // and no Origin.
    await page.context().clearCookies();
    await signInAsStaff(page, "event_coordinator");
    await page.goto("/dashboard");
    await waitForHydration(page);
    await page.getByRole("link", { name: eventName, exact: true }).click();
    await waitForHydration(page);
    await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
    const venue = page.locator("section#venue");
    await expect(venue.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(venue.getByText(reason)).toBeVisible();
    await expect(venue.getByText(`${alternativeName}, 14 Oct 2037, 10:00–13:30`)).toBeVisible();
  } finally {
    await database.delete(schema.venueRequests).where(eq(schema.venueRequests.id, requestId));
    if (eventId !== undefined) {
      await database.delete(schema.eventRequests).where(eq(schema.eventRequests.id, eventId));
    }
    await database.delete(schema.venues).where(inArray(schema.venues.id, venueIds));
    await database.delete(schema.user).where(eq(schema.user.id, organiserId));
  }
});
