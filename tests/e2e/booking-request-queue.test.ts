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

test("[PTR-32] Venue Staff see conflict flags and multiline live requirements", async ({
  page,
}) => {
  const organiserId = randomUUID();
  const approvedEventName = `PTR-32 Approved Event ${randomUUID()}`;
  const pendingEventName = `PTR-32 Hidden Event ${randomUUID()}`;
  const secondPendingEventName = `PTR-32 Second Hidden Event ${randomUUID()}`;
  const venueNames = [`PTR-32 Conflict Hall ${randomUUID()}`, `PTR-32 Second Hall ${randomUUID()}`];
  const requestIds = [randomUUID(), randomUUID(), randomUUID()];
  let venueIds: number[] = [];
  let eventIds: number[] = [];

  try {
    await database.insert(schema.user).values({
      id: organiserId,
      name: "PTR-32 Browser Organiser",
      email: `${organiserId}@example.invalid`,
      role: "event_organiser",
    });

    const venues = await database
      .insert(schema.venues)
      .values(
        venueNames.map(name => ({
          name,
          location: "PTR-32 Browser Wing",
          maxCapacity: 300,
          operatingHours: DEFAULT_OPERATING_HOURS,
        }))
      )
      .returning({ id: schema.venues.id });
    venueIds = venues.map(venue => venue.id);

    // One card per connected event: each pending request needs its own event, or the newer one
    // hides the older behind the same card.
    const events = await database
      .insert(schema.eventRequests)
      .values([
        {
          organiserId,
          eventName: pendingEventName,
          status: "submitted",
          submittedAt: new Date("2037-05-01T00:00:00Z"),
          proposedDates: [{ start: "2037-05-10T09:00", end: "2037-05-10T12:00" }],
          expectedAttendance: null,
          roomLayoutPreference: "Theatre",
          accessibilityRequirements: "Step-free access.\nReserved seating.",
          venueRequirements: "Projector.\nTwo wireless microphones.",
        },
        {
          organiserId,
          eventName: approvedEventName,
          status: "submitted",
          submittedAt: new Date("2037-05-01T00:01:00Z"),
        },
        {
          organiserId,
          eventName: secondPendingEventName,
          status: "submitted",
          submittedAt: new Date("2037-05-01T00:02:00Z"),
          proposedDates: [{ start: "2037-05-10T09:00", end: "2037-05-10T12:00" }],
          expectedAttendance: null,
          roomLayoutPreference: "Theatre",
          accessibilityRequirements: "Step-free access.\nReserved seating.",
          venueRequirements: "Projector.\nTwo wireless microphones.",
        },
      ])
      .returning({ id: schema.eventRequests.id });
    eventIds = events.map(event => event.id);

    await database.insert(schema.venueRequests).values([
      {
        id: requestIds[2],
        eventId: eventIds[1],
        venueId: venueIds[0],
        requestedById: organiserId,
        startsAt: "2037-05-10 09:00:00",
        endsAt: "2037-05-10 12:00:00",
        status: "approved",
        createdAt: new Date("2037-05-02T00:00:00Z"),
      },
      {
        id: requestIds[0],
        eventId: eventIds[0],
        venueId: venueIds[0],
        requestedById: organiserId,
        startsAt: "2037-05-10 10:00:00",
        endsAt: "2037-05-10 11:00:00",
        createdAt: new Date("2037-05-02T01:00:00Z"),
      },
      {
        id: requestIds[1],
        eventId: eventIds[2],
        venueId: venueIds[1],
        requestedById: organiserId,
        startsAt: "2037-05-10 10:00:00",
        endsAt: "2037-05-10 11:00:00",
        createdAt: new Date("2037-05-02T02:00:00Z"),
      },
    ]);

    await signInAsStaff(page, "venue_staff");
    // The queue route is gone: it answers 404. Each pending request is a card on the
    // dashboard instead.
    await page.goto("/venue-requests");
    await expect(page.getByRole("heading", { name: "404 - Not Found" })).toBeVisible();
    await page.goto("/dashboard");
    await waitForHydration(page);

    // The venue name is the card's only link; the event name stays withheld.
    await expect(page.getByRole("link", { name: venueNames[0], exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: venueNames[1], exact: true })).toBeVisible();
    await expect(page.getByText(approvedEventName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(pendingEventName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(secondPendingEventName, { exact: true })).toHaveCount(0);

    await page.getByRole("link", { name: venueNames[0], exact: true }).click();
    await waitForHydration(page);

    await expect(page).toHaveURL(new RegExp(`/events/${eventIds[0]}$`));
    await expect(page.getByRole("heading", { name: "Booking request details" })).toBeVisible();
    await expect(page.getByText("Conflicting booking").first()).toBeVisible();
    const accessibility = page.locator("dd").filter({ hasText: "Step-free access." }).first();
    const facilities = page.locator("dd").filter({ hasText: "Projector." }).first();
    await expect(accessibility).toBeVisible();
    await expect(facilities).toBeVisible();
    expect(await accessibility.textContent()).toBe("Step-free access.\nReserved seating.");
    expect(await facilities.textContent()).toBe("Projector.\nTwo wireless microphones.");
    expect(await accessibility.evaluate(element => getComputedStyle(element).whiteSpace)).toBe(
      "pre-line"
    );
    expect(await facilities.evaluate(element => getComputedStyle(element).whiteSpace)).toBe(
      "pre-line"
    );
    await expect(page.getByText(pendingEventName, { exact: true })).toHaveCount(0);

    // The approved request left `pending`, so Venue Staff can no longer open its event either.
    await page.goto(`/events/${eventIds[1]}`);
    await waitForHydration(page);
    await expect(page.getByRole("heading", { name: "404 - Not Found" })).toBeVisible();

    // The second pending request shows its event's facilities and drops the null attendance
    // term rather than rendering a labelled blank.
    await page.goto("/dashboard");
    await waitForHydration(page);
    await page.getByRole("link", { name: venueNames[1], exact: true }).click();
    await waitForHydration(page);
    await expect(page).toHaveURL(new RegExp(`/events/${eventIds[2]}$`));
    await expect(page.getByRole("heading", { name: "Booking request details" })).toBeVisible();
    await expect(page.locator("dd").filter({ hasText: "Projector." }).first()).toBeVisible();
    await expect(page.getByText("Expected attendance", { exact: true })).toHaveCount(0);
  } finally {
    await database.delete(schema.venueRequests).where(inArray(schema.venueRequests.id, requestIds));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, eventIds));
    await database.delete(schema.venues).where(inArray(schema.venues.id, venueIds));
    await database.delete(schema.user).where(eq(schema.user.id, organiserId));
  }
});
