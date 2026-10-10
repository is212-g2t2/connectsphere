// oxlint-disable node/no-process-env
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { DEFAULT_OPERATING_HOURS } from "../../src/features/venues/schema";
import { waitForHydration } from "./hydration";
import { waitForEmail } from "./mailpit";
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
    // The queue route is gone: it answers 404. Each pending request is a card on the
    // dashboard, named by its venue. The decision happens on the event page.
    await page.goto("/venue-requests");
    await expect(page.getByRole("heading", { name: "404 - Not Found" })).toBeVisible();
    await page.goto("/dashboard");
    await waitForHydration(page);

    // Both pending requests share one venue, so both cards carry its name; the href picks the
    // card for the first event.
    const venueLinks = page.getByRole("link", { name: venueName, exact: true });
    await expect(venueLinks).toHaveCount(2);
    await page.locator(`a[href="/events/${eventIds[0]}"]`).click();
    await waitForHydration(page);
    await expect(page).toHaveURL(new RegExp(`/events/${eventIds[0]}$`));

    const decision = page.locator("section#decision");
    await expect(decision).toBeVisible();
    await decision
      .getByRole("button", { name: `Approve request for ${venueName}, 10 Jun 2037, 09:00` })
      .click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.getByText(`Booking approved for ${venueName} from 10 Jun 2037, 09:00.`)
    ).toBeVisible();

    // The page refreshes in place: no navigation back to a queue.
    await expect(page).toHaveURL(new RegExp(`/events/${eventIds[0]}$`));
    await expect(
      page.getByRole("button", { name: `Approve request for ${venueName}, 10 Jun 2037, 09:00` })
    ).toHaveCount(0);

    // The requesting Coordinator is told by real mail, naming the venue and the event.
    const approvalEmail = await waitForEmail(
      `${coordinatorId}@example.invalid`,
      `Venue booking approved: ${venueName}`
    );
    expect(approvalEmail).toContain(venueName);
    expect(approvalEmail).toContain("PTR-33 First");

    // AC3, browser-proven: the approved window shows as a confirmed booking on the venue
    // calendar, pinned to the exact period just approved, not merely "not pending" anymore.
    await page.goto(
      `/venues/availability?venueId=${venueId}&startDate=2037-06-10&endDate=2037-06-10`
    );
    await waitForHydration(page);
    const calendarResults = page.getByRole("region", { name: "Availability results" });
    await expect(calendarResults.getByText("Confirmed booking", { exact: true })).toBeVisible();
    await expect(calendarResults.getByText(/09:00 – 12:00/)).toBeVisible();

    await page.goto(`/events/${eventIds[1]}`);
    await waitForHydration(page);

    // AC3: the second, overlapping request is now flagged, and approving it is refused by name.
    await page
      .locator("section#decision")
      .getByRole("button", { name: `Approve request for ${venueName}, 10 Jun 2037, 11:00` })
      .click();
    await page.getByRole("button", { name: "Confirm" }).click();
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
