// oxlint-disable node/no-process-env
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
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

test("[PTR-37] redirects unauthenticated visitors from approved bookings", async ({ page }) => {
  await page.goto("/venue-bookings");
  await expect(page).toHaveURL(/\/login/);
});

test("[PTR-37] Venue Staff can see an upcoming approved booking and its actions", async ({
  page,
}) => {
  const coordinatorId = randomUUID();
  const requestId = randomUUID();
  let venueId: number | undefined;
  let eventId: number | undefined;

  try {
    await database.insert(schema.user).values({
      id: coordinatorId,
      name: "PTR-37 Browser Coordinator",
      email: `${coordinatorId}@example.invalid`,
      role: "event_coordinator",
    });
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: `PTR-37 Browser Hall ${randomUUID()}`,
        location: "PTR-37 Browser Wing",
        maxCapacity: 300,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id, name: schema.venues.name });
    venueId = venue.id;

    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: coordinatorId,
        assignedCoordinatorId: coordinatorId,
        assignedAt: new Date("2037-06-01T00:00:00Z"),
        eventName: "PTR-37 Browser Event",
        status: "submitted",
        submittedAt: new Date("2037-06-01T00:00:00Z"),
      })
      .returning({ id: schema.eventRequests.id, eventName: schema.eventRequests.eventName });
    eventId = event.id;

    const [staff] = await database
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, "venue.staff.seed@example.com"))
      .limit(1);
    if (!staff) throw new Error("Seeded Venue Staff account is missing");

    await database.insert(schema.venueRequests).values({
      id: requestId,
      eventId,
      venueId,
      requestedById: coordinatorId,
      assignedStaffId: staff.id,
      status: "approved",
      startsAt: "2037-06-10 09:00:00",
      endsAt: "2037-06-10 12:00:00",
      createdAt: new Date("2037-06-02T00:00:00Z"),
    });

    await signInAsStaff(page, "venue_staff");
    await page.goto("/venue-bookings");
    await waitForHydration(page);

    await expect(page.getByRole("heading", { name: "Approved bookings" })).toBeVisible();
    await expect(page.getByText("PTR-37 Browser Event")).toBeVisible();
    await expect(page.getByText(venue.name, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: `Amend ${event.eventName}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Release ${event.eventName}` })).toBeVisible();
  } finally {
    await database.delete(schema.venueRequests).where(eq(schema.venueRequests.id, requestId));
    if (eventId !== undefined) {
      await database.delete(schema.eventRequests).where(eq(schema.eventRequests.id, eventId));
    }
    if (venueId !== undefined) {
      await database.delete(schema.venues).where(eq(schema.venues.id, venueId));
    }
    await database.delete(schema.user).where(eq(schema.user.id, coordinatorId));
  }
});

test("[PTR-37] a booking managed by another Venue Staff member offers no actions", async ({
  page,
}) => {
  const coordinatorId = randomUUID();
  const colleagueId = randomUUID();
  const requestId = randomUUID();
  let venueId: number | undefined;
  let eventId: number | undefined;

  try {
    await database.insert(schema.user).values({
      id: coordinatorId,
      name: "PTR-37 Colleague Coordinator",
      email: `${coordinatorId}@example.invalid`,
      role: "event_coordinator",
    });
    await database.insert(schema.user).values({
      id: colleagueId,
      name: "PTR-37 Colleague Staff",
      email: `${colleagueId}@example.invalid`,
      role: "venue_staff",
    });
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: `PTR-37 Colleague Hall ${randomUUID()}`,
        location: "PTR-37 Colleague Wing",
        maxCapacity: 300,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id, name: schema.venues.name });
    venueId = venue.id;

    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: coordinatorId,
        assignedCoordinatorId: coordinatorId,
        assignedAt: new Date("2037-06-01T00:00:00Z"),
        eventName: "PTR-37 Colleague Event",
        status: "submitted",
        submittedAt: new Date("2037-06-01T00:00:00Z"),
      })
      .returning({ id: schema.eventRequests.id, eventName: schema.eventRequests.eventName });
    eventId = event.id;

    await database.insert(schema.venueRequests).values({
      id: requestId,
      eventId,
      venueId,
      requestedById: coordinatorId,
      assignedStaffId: colleagueId,
      status: "approved",
      startsAt: "2037-06-10 09:00:00",
      endsAt: "2037-06-10 12:00:00",
      createdAt: new Date("2037-06-02T00:00:00Z"),
    });

    await signInAsStaff(page, "venue_staff");
    await page.goto("/venue-bookings");
    await waitForHydration(page);

    await expect(page.getByText("PTR-37 Colleague Event")).toBeVisible();
    await expect(page.getByText("Managed by another Venue Staff member.")).toBeVisible();
    await expect(page.getByRole("button", { name: `Release ${event.eventName}` })).toHaveCount(0);
  } finally {
    await database.delete(schema.venueRequests).where(eq(schema.venueRequests.id, requestId));
    if (eventId !== undefined) {
      await database.delete(schema.eventRequests).where(eq(schema.eventRequests.id, eventId));
    }
    if (venueId !== undefined) {
      await database.delete(schema.venues).where(eq(schema.venues.id, venueId));
    }
    await database.delete(schema.user).where(eq(schema.user.id, coordinatorId));
    await database.delete(schema.user).where(eq(schema.user.id, colleagueId));
  }
});
