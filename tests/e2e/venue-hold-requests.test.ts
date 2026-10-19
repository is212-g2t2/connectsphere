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

test("[PTR-150] redirects unauthenticated visitors from hold requests", async ({ page }) => {
  await page.goto("/venue-holds");
  await expect(page).toHaveURL(/\/login/);
});

test("[PTR-150] redirects a Coordinator from hold requests to the dashboard", async ({ page }) => {
  await signInAsStaff(page, "event_coordinator");
  await page.goto("/venue-holds");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("[PTR-150] Venue Staff place a hold request from the shared queue", async ({ page }) => {
  const coordinatorId = randomUUID();
  const holdId = randomUUID();
  let venueId: number | undefined;
  let eventId: number | undefined;

  try {
    await database.insert(schema.user).values({
      id: coordinatorId,
      name: "PTR-150 Browser Coordinator",
      email: `${coordinatorId}@example.invalid`,
      role: "event_coordinator",
    });
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: `PTR-150 Browser Hall ${randomUUID()}`,
        location: "PTR-150 Browser Wing",
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
        eventName: "PTR-150 Browser Event",
        status: "submitted",
        submittedAt: new Date("2037-06-01T00:00:00Z"),
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;
    await database.insert(schema.venueHolds).values({
      id: holdId,
      eventId,
      venueId,
      startsAt: "2037-06-10 09:00:00",
      endsAt: "2037-06-10 12:00:00",
      status: "requested",
      heldById: coordinatorId,
    });

    await signInAsStaff(page, "venue_staff");
    await page.goto("/venue-holds");
    await waitForHydration(page);

    await expect(page.getByRole("heading", { name: "Hold requests" })).toBeVisible();
    const item = page.getByRole("listitem", { name: venue.name });
    await expect(item.getByText("10 Jun 2037, 09:00 – 12:00")).toBeVisible();

    await item.getByRole("button", { name: "Place hold" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Date and time").fill("2037-06-05T12:00");
    await dialog.getByRole("button", { name: "Place hold" }).click();

    await expect(page.getByText("Tentative hold placed.")).toBeVisible();
    await expect(item).toHaveCount(0);
    const [placed] = await database
      .select({ status: schema.venueHolds.status, expiresAt: schema.venueHolds.expiresAt })
      .from(schema.venueHolds)
      .where(eq(schema.venueHolds.id, holdId));
    expect(placed).toEqual({ status: "held", expiresAt: "2037-06-05 12:00:00" });
  } finally {
    // The event cascade removes the hold, its ledger row and its notifications.
    if (eventId !== undefined) {
      await database.delete(schema.eventRequests).where(eq(schema.eventRequests.id, eventId));
    }
    if (venueId !== undefined) {
      await database.delete(schema.venues).where(eq(schema.venues.id, venueId));
    }
    await database.delete(schema.user).where(eq(schema.user.id, coordinatorId));
  }
});
