// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleSearchVenues } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

const users = {
  organiser: {
    id: "venue-search-organiser",
    name: "Venue Search Organiser",
    email: "venue-search-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "venue-search-coordinator",
    name: "Venue Search Coordinator",
    email: "venue-search-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  otherCoordinator: {
    id: "venue-search-other-coordinator",
    name: "Other Venue Search Coordinator",
    email: "venue-search-other-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const venueNames = ["PTR-29 Matching Hall", "PTR-29 Small Room"];
const userIds = Object.values(users).map(user => user.id);

function session(user: (typeof users)["coordinator"]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

describe("venue search handler (PTR-29)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let eventId: number;
  let crossMidnightEventId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  afterAll(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, [users.organiser.id]));
    await database.delete(schema.venues).where(inArray(schema.venues.name, venueNames));
    await database.delete(schema.user).where(inArray(schema.user.id, userIds));
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, [users.organiser.id]));
    await database.delete(schema.venues).where(inArray(schema.venues.name, venueNames));

    await database.insert(schema.venues).values([
      {
        name: venueNames[0],
        location: "East Wing",
        maxCapacity: 200,
        facilities: ["Projector", "PA system"],
        accessibilityFeatures: ["Step-free access"],
        supportedLayouts: ["theatre"],
        operatingHours: DEFAULT_OPERATING_HOURS,
      },
      {
        name: venueNames[1],
        location: "West Wing",
        maxCapacity: 30,
        facilities: ["Whiteboard"],
        accessibilityFeatures: [],
        supportedLayouts: ["boardroom"],
        operatingHours: DEFAULT_OPERATING_HOURS,
      },
    ]);

    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-29 Event",
        proposedDates: [{ start: "2027-03-15T10:00", end: "2027-03-15T12:00" }],
        expectedAttendance: 120,
        roomLayoutPreference: "Theatre seating",
        accessibilityRequirements: "Step-free access",
        venueRequirements: "Projector, PA system",
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;

    const [crossMidnightEvent] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-29 Cross-midnight Event",
        proposedDates: [{ start: "2027-03-16T22:00", end: "2027-03-17T02:00" }],
        expectedAttendance: 120,
        roomLayoutPreference: "Theatre seating",
        venueRequirements: "Projector, PA system",
      })
      .returning({ id: schema.eventRequests.id });
    crossMidnightEventId = crossMidnightEvent.id;
  });

  it("ANDs every supplied filter and returns only matching venue records", async () => {
    const result = await handleSearchVenues(
      {
        date: "2027-03-15",
        startTime: "10:00",
        endTime: "12:00",
        expectedAttendance: 120,
        capacity: 150,
        location: "east",
        accessibility: "Step-free access",
        layout: "theatre",
        facilities: "Projector, PA system",
      },
      session(users.coordinator),
      database as never
    );

    expect(result.venues.map(venue => venue.name)).toEqual([venueNames[0]]);
  });

  it("returns the venues that fell short with each failing criterion named (PTR-30 AC5)", async () => {
    const result = await handleSearchVenues(
      {
        expectedAttendance: "120",
        layout: "theatre",
        facilities: "Projector, PA system",
        accessibility: "Step-free access",
      },
      session(users.coordinator),
      database as never
    );

    const small = result.unsuitable.find(({ venue }) => venue.name === venueNames[1]);
    expect(small?.failures).toEqual([
      { criterion: "capacity", message: "Holds 30; 120 needed" },
      { criterion: "layout", message: "Does not offer Theatre" },
      { criterion: "accessibility", message: "Missing accessibility: step, free, access" },
      { criterion: "facilities", message: "Missing facilities: projector, pa, system" },
    ]);
    expect(result.unsuitable.map(({ venue }) => venue.name)).not.toContain(venueNames[0]);
  });

  it.each(["under_review", "awaiting_organiser", "approved"] as const)(
    "still prefills from an assigned event that is %s (PTR-30)",
    async status => {
      await database
        .update(schema.eventRequests)
        .set(
          status === "approved"
            ? {
                status,
                decidedByCoordinatorId: users.coordinator.id,
                decidedByCoordinatorName: users.coordinator.name,
                decidedAt: new Date(),
              }
            : { status }
        )
        .where(eq(schema.eventRequests.id, eventId));

      const result = await handleSearchVenues(
        { eventId },
        session(users.coordinator),
        database as never
      );
      expect(result.event).toEqual({ id: eventId, name: "PTR-29 Event" });

      await database
        .update(schema.eventRequests)
        .set({
          status: "submitted",
          decidedByCoordinatorId: null,
          decidedByCoordinatorName: null,
          decidedAt: null,
        })
        .where(eq(schema.eventRequests.id, eventId));
    }
  );

  it("excludes a venue when recorded unavailability overlaps the requested time", async () => {
    const [venue] = await database
      .select({ id: schema.venues.id })
      .from(schema.venues)
      .where(eq(schema.venues.name, venueNames[0]));
    await database.insert(schema.venueUnavailability).values({
      venueId: venue.id,
      startsAt: "2027-03-15 10:30:00",
      endsAt: "2027-03-15 11:30:00",
      reason: "PTR-29 integration block",
    });

    const result = await handleSearchVenues(
      {
        date: "2027-03-15",
        startTime: "10:00",
        endTime: "12:00",
        location: "East Wing",
      },
      session(users.coordinator),
      database as never
    );

    expect(result.venues).toEqual([]);
  });

  it("prefills filters from an assigned event and applies them immediately", async () => {
    const result = await handleSearchVenues(
      { eventId },
      session(users.coordinator),
      database as never
    );

    expect(result.event).toEqual({ id: eventId, name: "PTR-29 Event" });
    expect(result.filters).toMatchObject({
      eventId,
      date: "2027-03-15",
      endDate: "2027-03-15",
      startTime: "10:00",
      endTime: "12:00",
      expectedAttendance: 120,
      accessibility: "Step-free access",
      layout: "Theatre seating",
      facilities: "Projector, PA system",
    });
    // The same-day hotel window is matchable, so the prefill returns the venue it describes.
    expect(result.venues.map(venue => venue.name)).toContain(venueNames[0]);
  });

  it("prefills a cross-midnight event but matches no venue", async () => {
    const result = await handleSearchVenues(
      { eventId: crossMidnightEventId },
      session(users.coordinator),
      database as never
    );

    expect(result.filters).toMatchObject({
      eventId: crossMidnightEventId,
      date: "2027-03-16",
      endDate: "2027-03-17",
      startTime: "22:00",
      endTime: "02:00",
    });
    // Suitability refuses a window that runs past midnight, whatever the venue's hours.
    expect(result.venues).toEqual([]);
  });

  it("matches a venue open across every day of a multi-day window", async () => {
    const result = await handleSearchVenues(
      {
        date: "2027-03-15",
        endDate: "2027-03-16",
        startTime: "10:00",
        endTime: "12:00",
        location: "East Wing",
      },
      session(users.coordinator),
      database as never
    );

    expect(result.venues.map(venue => venue.name)).toEqual([venueNames[0]]);
  });

  it("keeps an event default when a hand-edited parameter is explicitly undefined", async () => {
    const result = await handleSearchVenues(
      { eventId, date: undefined },
      session(users.coordinator),
      database as never
    );

    expect(result.filters.date).toBe("2027-03-15");
  });

  it("refuses to expose another Coordinator's event requirements", async () => {
    await expect(
      handleSearchVenues({ eventId }, session(users.otherCoordinator), database as never)
    ).rejects.toThrow("Forbidden");
  });
});
