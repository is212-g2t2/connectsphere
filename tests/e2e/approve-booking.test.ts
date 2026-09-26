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

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

test.beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});

test.afterAll(async () => {
  await pool.end();
});

test("[PTR-33] Venue Staff approve from the queue, and an overlapping approval is refused", async ({
  page,
}) => {
  const coordinatorId = randomUUID();
  const venueName = `PTR-33 Approval Hall ${randomUUID()}`;
  const requestIds = [randomUUID(), randomUUID()];
  let venueId: number | undefined;
  let eventIds: number[] = [];

  try {
    await database.insert(schema.user).values({
      id: coordinatorId,
      name: "PTR-33 Browser Coordinator",
      email: `${coordinatorId}@example.invalid`,
      role: "event_coordinator",
    });

    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: venueName,
        location: "PTR-33 Browser Wing",
        maxCapacity: 300,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    venueId = venue.id;

    const events = await database
      .insert(schema.eventRequests)
      .values(
        ["PTR-33 First", "PTR-33 Second"].map(eventName => ({
          organiserId: coordinatorId,
          eventName,
          status: "submitted" as const,
          submittedAt: new Date("2037-06-01T00:00:00Z"),
        }))
      )
      .returning({ id: schema.eventRequests.id });
    eventIds = events.map(event => event.id);

    await database.insert(schema.venueRequests).values([
      {
        id: requestIds[0],
        eventId: eventIds[0],
        venueId,
        requestedById: coordinatorId,
        startsAt: "2037-06-10 09:00:00",
        endsAt: "2037-06-10 12:00:00",
        createdAt: new Date("2037-06-02T00:00:00Z"),
      },
      {
        id: requestIds[1],
        eventId: eventIds[1],
        venueId,
        requestedById: coordinatorId,
        startsAt: "2037-06-10 11:00:00",
        endsAt: "2037-06-10 13:00:00",
        createdAt: new Date("2037-06-02T01:00:00Z"),
      },
    ]);

    await signInAsStaff(page, "venue_staff");
    await page.goto("/venue-requests");
    await waitForHydration(page);

    await page
      .getByRole("button", { name: `Approve request for ${venueName}, 10 Jun 2037, 09:00` })
      .click();

    await expect(page.getByText(`Booking approved for ${venueName}.`)).toBeVisible();
    await expect(
      page.getByRole("link", { name: `Open request for ${venueName}, 10 Jun 2037, 09:00` })
    ).toHaveCount(0);

    // AC3: the second, overlapping request is now flagged, and approving it is refused by name.
    await page
      .getByRole("button", { name: `Approve request for ${venueName}, 10 Jun 2037, 11:00` })
      .click();
    await expect(page.getByRole("alert").filter({ hasText: venueName })).toHaveText(
      `${venueName} is already booked 10 Jun 2037, 09:00 – 12:00`
    );

    const rows = await database
      .select({ id: schema.venueRequests.id, status: schema.venueRequests.status })
      .from(schema.venueRequests)
      .where(inArray(schema.venueRequests.id, requestIds));
    expect(Object.fromEntries(rows.map(row => [row.id, row.status]))).toEqual({
      [requestIds[0]]: "approved",
      [requestIds[1]]: "pending",
    });
  } finally {
    await database.delete(schema.venueRequests).where(inArray(schema.venueRequests.id, requestIds));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, eventIds));
    if (venueId !== undefined) {
      await database.delete(schema.venues).where(eq(schema.venues.id, venueId));
    }
    await database.delete(schema.user).where(eq(schema.user.id, coordinatorId));
  }
});
