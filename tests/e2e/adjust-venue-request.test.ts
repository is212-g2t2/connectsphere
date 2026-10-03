// oxlint-disable node/no-process-env
//
// PTR-35: from a rejection carrying a suggestion, the Coordinator opens the suggested venue
// pre-filled, sends the adjusted request, and still sees the original rejection on the card.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../src/db/schema";
import { DEFAULT_OPERATING_HOURS } from "../../src/features/venues/schema";
import { waitForHydration } from "./hydration";
import { signInAsStaff } from "./staff-auth";

const SEED_COORDINATOR_ID = "seed-coordinator-1";

let pool: Pool;
let database: ReturnType<typeof drizzle<typeof schema>>;

test.beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in the Playwright process.");
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
});

test.afterAll(async () => {
  await pool?.end();
});

test("[PTR-35] the Coordinator adjusts a rejected request from the suggestion and the rejection stays on the card", async ({
  page,
}) => {
  const organiserId = randomUUID();
  const eventName = `PTR-35 Event ${randomUUID().slice(0, 8)}`;
  const refusedName = `PTR-35 Refused Hall ${randomUUID().slice(0, 8)}`;
  const suggestedName = `PTR-35 Suggested Room ${randomUUID().slice(0, 8)}`;
  const reason = `Closed for floor resurfacing ${randomUUID().slice(0, 8)}`;
  let venueIds: number[] = [];
  let eventId: number | undefined;

  try {
    await database.insert(schema.user).values({
      id: organiserId,
      name: "PTR-35 Browser Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });
    const venues = await database
      .insert(schema.venues)
      .values(
        [refusedName, suggestedName].map(name => ({
          name,
          location: "PTR-35 Browser Wing",
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
        equipmentRequirements: [],
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;
    // The rejection as PTR-34 records it: a reason plus a full suggestion of the other room.
    await database.insert(schema.venueRequests).values({
      id: randomUUID(),
      eventId,
      venueId: venueIds[0],
      requestedById: SEED_COORDINATOR_ID,
      startsAt: "2037-10-13 09:00:00",
      endsAt: "2037-10-13 12:00:00",
      status: "rejected",
      rejectionReason: reason,
      suggestedVenueId: venueIds[1],
      suggestedDate: "2037-10-14",
      suggestedStartTime: "10:00:00",
      suggestedEndTime: "13:30:00",
    });

    await signInAsStaff(page, "event_coordinator");
    await page.goto("/dashboard");
    await waitForHydration(page);
    const card = page.locator("[data-slot=card]").filter({ hasText: eventName });
    await expect(card.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(card.getByText(reason)).toBeVisible();

    // AC1: the suggestion opens the suggested venue with the window already filled in.
    await card.getByRole("link", { name: `Adjust request at ${suggestedName}` }).click();
    await waitForHydration(page);
    await expect(page).toHaveURL(new RegExp(`/venues/${venueIds[1]}\\?`));
    await expect(page.getByRole("heading", { name: suggestedName })).toBeVisible();
    await expect(page.getByLabel("Date (required)")).toHaveValue("2037-10-14");
    await expect(page.getByLabel("Start time (required)")).toHaveValue("10:00");
    await expect(page.getByLabel("End time (required)")).toHaveValue("13:30");
    await expect(page.getByText(/carried over from the rejection card/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Request this venue" })).toBeFocused();

    // AC2: sending it queues a new pending request.
    await page.getByRole("button", { name: "Send booking request" }).click();
    const panel = page.getByRole("region", { name: "Venue request" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Pending", { exact: true })).toBeVisible();
    const rows = await database
      .select({ status: schema.venueRequests.status, venueId: schema.venueRequests.venueId })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.eventId, eventId));
    expect(rows.map(row => row.status).toSorted()).toEqual(["pending", "rejected"]);
    expect(rows.find(row => row.status === "pending")?.venueId).toBe(venueIds[1]);

    // AC3 and AC4: the card shows the pending request and still the original rejection; the
    // event is still submitted.
    await page.goto("/dashboard");
    await waitForHydration(page);
    const reloaded = page.locator("[data-slot=card]").filter({ hasText: eventName });
    await expect(reloaded.getByText("Pending", { exact: true })).toBeVisible();
    await expect(reloaded.getByText("Previously rejected booking")).toBeVisible();
    await expect(reloaded.getByText(reason)).toBeVisible();
    await expect(reloaded.getByRole("link", { name: /^Adjust request at / })).toHaveCount(0);
    const [row] = await database
      .select({ status: schema.eventRequests.status })
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, eventId));
    expect(row.status).toBe("submitted");
  } finally {
    if (eventId !== undefined) {
      await database.delete(schema.eventRequests).where(eq(schema.eventRequests.id, eventId));
    }
    if (venueIds.length > 0) {
      await database.delete(schema.venues).where(inArray(schema.venues.id, venueIds));
    }
    await database.delete(schema.user).where(eq(schema.user.id, organiserId));
  }
});
