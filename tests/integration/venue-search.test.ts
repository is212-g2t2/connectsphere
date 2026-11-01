// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleSearchVenues } from "#/features/venues/records.server";
import type { VenueBookingLoader } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS, LAYOUT_MESSAGE } from "#/features/venues/schema";

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
      { criterion: "accessibility", message: "Missing accessibility: Step-free access" },
      { criterion: "facilities", message: "Missing facilities: Projector, PA system" },
    ]);
    expect(result.unsuitable.map(({ venue }) => venue.name)).not.toContain(venueNames[0]);
  });

  it("assesses the bookings the loader supplies for the requested period (PTR-30 AC1, AC4)", async () => {
    const [hall] = await database
      .select({ id: schema.venues.id })
      .from(schema.venues)
      .where(eq(schema.venues.name, venueNames[0]));
    const calls: { venueIds: readonly number[]; startsAt: string; endsAt: string }[] = [];
    const loadBookings: VenueBookingLoader = async (_database, venueIds, startsAt, endsAt) => {
      calls.push({ venueIds, startsAt, endsAt });
      return [
        {
          venueId: hall.id,
          id: "booking-1",
          label: "Annual dinner",
          startsAt: "2027-03-15T11:00:00",
          endsAt: "2027-03-15T13:00:00",
        },
      ];
    };

    const result = await handleSearchVenues(
      { date: "2027-03-15", startTime: "10:00", endTime: "12:00" },
      session(users.coordinator),
      database as never,
      loadBookings
    );

    // The shared read widens past the requested day by the largest candidate buffers, so
    // assert coverage rather than exact bounds: another venue's buffers widen the window.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.venueIds).toEqual(expect.arrayContaining([hall.id]));
    expect(calls[0]?.startsAt <= "2027-03-15 00:00:00").toBe(true);
    expect(calls[0]?.endsAt >= "2027-03-16 00:00:00").toBe(true);
    expect(result.venues.map(venue => venue.id)).not.toContain(hall.id);
    expect(result.unsuitable.find(({ venue }) => venue.id === hall.id)?.failures).toEqual([
      { criterion: "booking", message: "Booked for Annual dinner on 2027-03-15" },
    ]);
  });

  it.each(["under_review", "awaiting_organiser", "approved", "planning"] as const)(
    "still prefills from an assigned event that is %s (PTR-30)",
    async status => {
      await database
        .update(schema.eventRequests)
        .set(
          status === "approved" || status === "planning"
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
    const [block] = await database
      .insert(schema.venueUnavailability)
      .values({
        venueId: venue.id,
        startsAt: "2027-03-15 10:30:00",
        endsAt: "2027-03-15 11:30:00",
        reason: "PTR-29 integration block",
      })
      .returning({ id: schema.venueUnavailability.id });
    // The block writers record the ledger row in the same transaction (ADR-7).
    await database.insert(schema.venueOccupancy).values({
      venueId: venue.id,
      eventId: null,
      venueUnavailabilityId: block.id,
      startsAt: "2027-03-15 10:30:00",
      endsAt: "2027-03-15 11:30:00",
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

  it("excludes a venue when only a stored booking buffer overlaps the requested time", async () => {
    const [venue] = await database
      .select({ id: schema.venues.id })
      .from(schema.venues)
      .where(eq(schema.venues.name, venueNames[0]));
    // The write path stores the booking times with the venue's buffer minutes beside them. The
    // readers must apply the buffers (PTR-135 AC1): 10:00-12:00 with 30/45 occupies 09:30-12:45.
    const [booking] = await database
      .insert(schema.venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId,
        venueId: venue.id,
        requestedById: users.coordinator.id,
        startsAt: "2027-03-15 10:00:00",
        endsAt: "2027-03-15 12:00:00",
        status: "approved",
      })
      .returning({ id: schema.venueRequests.id });
    await database.insert(schema.venueOccupancy).values({
      venueId: venue.id,
      eventId,
      venueRequestId: booking.id,
      startsAt: "2027-03-15 10:00:00",
      endsAt: "2027-03-15 12:00:00",
      setupMinutes: 30,
      turnaroundMinutes: 45,
    });

    const inBuffer = await handleSearchVenues(
      { date: "2027-03-15", startTime: "12:30", endTime: "13:00", location: "East Wing" },
      session(users.coordinator),
      database as never
    );
    expect(inBuffer.venues).toEqual([]);

    // The half-open period ends at 12:45, so a later window is free.
    const afterBuffer = await handleSearchVenues(
      { date: "2027-03-15", startTime: "12:45", endTime: "14:00", location: "East Wing" },
      session(users.coordinator),
      database as never
    );
    expect(afterBuffer.venues.map(row => row.name)).toEqual([venueNames[0]]);
  });

  it("reports unsuitable with the booking reason for a window approval would refuse solely because of the venue buffers (PTR-161 AC8)", async () => {
    const [hall] = await database
      .select({ id: schema.venues.id })
      .from(schema.venues)
      .where(eq(schema.venues.name, venueNames[0]));
    // The venue holds 60 minutes setup and turnaround. The booking stores no buffers, so its
    // occupied period is exactly 10:00–12:00. Approval expands the candidate window
    // (`checkVenueFree`/`overlapsPeriod`, ADR-7): 12:30–13:00 becomes 11:30–14:00 and overlaps
    // the booking, while 13:00–14:00 becomes 12:00–15:00 and only touches it.
    await database
      .update(schema.venues)
      .set({ setupMinutes: 60, turnaroundMinutes: 60 })
      .where(eq(schema.venues.id, hall.id));
    const [booking] = await database
      .insert(schema.venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId,
        venueId: hall.id,
        requestedById: users.coordinator.id,
        startsAt: "2027-03-15 10:00:00",
        endsAt: "2027-03-15 12:00:00",
        status: "approved",
      })
      .returning({ id: schema.venueRequests.id });
    await database.insert(schema.venueOccupancy).values({
      venueId: hall.id,
      eventId,
      venueRequestId: booking.id,
      startsAt: "2027-03-15 10:00:00",
      endsAt: "2027-03-15 12:00:00",
      setupMinutes: 0,
      turnaroundMinutes: 0,
    });

    const result = await handleSearchVenues(
      { date: "2027-03-15", startTime: "12:30", endTime: "13:00", location: "East Wing" },
      session(users.coordinator),
      database as never
    );
    expect(result.venues.map(row => row.name)).not.toContain(venueNames[0]);
    expect(result.unsuitable.find(({ venue }) => venue.name === venueNames[0])?.failures).toEqual([
      { criterion: "booking", message: "Booked for another event on 2027-03-15" },
    ]);

    const later = await handleSearchVenues(
      { date: "2027-03-15", startTime: "13:00", endTime: "14:00", location: "East Wing" },
      session(users.coordinator),
      database as never
    );
    expect(later.venues.map(row => row.name)).toContain(venueNames[0]);
  });

  it("refuses windows whose buffers reach a booking outside the requested date (PTR-161 AC8)", async () => {
    const [hall] = await database
      .select({ id: schema.venues.id })
      .from(schema.venues)
      .where(eq(schema.venues.name, venueNames[0]));
    // The edge windows sit outside default hours (00:30 and past 22:00), so run this venue
    // all day: refusal then comes from the buffer alone, not from closing time.
    const allDay = {
      mon: { opens: "00:00", closes: "23:59" },
      tue: { opens: "00:00", closes: "23:59" },
      wed: { opens: "00:00", closes: "23:59" },
      thu: { opens: "00:00", closes: "23:59" },
      fri: { opens: "00:00", closes: "23:59" },
      sat: { opens: "00:00", closes: "23:59" },
      sun: { opens: "00:00", closes: "23:59" },
    };
    await database
      .update(schema.venues)
      .set({ setupMinutes: 60, turnaroundMinutes: 60, operatingHours: allDay })
      .where(eq(schema.venues.id, hall.id));
    async function approveBooking(startsAt: string, endsAt: string) {
      const [booking] = await database
        .insert(schema.venueRequests)
        .values({
          id: crypto.randomUUID(),
          eventId,
          venueId: hall.id,
          requestedById: users.coordinator.id,
          startsAt,
          endsAt,
          status: "approved",
        })
        .returning({ id: schema.venueRequests.id });
      await database.insert(schema.venueOccupancy).values({
        venueId: hall.id,
        eventId,
        venueRequestId: booking.id,
        startsAt,
        endsAt,
        setupMinutes: 0,
        turnaroundMinutes: 0,
      });
    }
    // Both bookings sit outside the searched day. Each candidate's buffer reaches one of them,
    // and approval (`checkVenueFree`/`overlapsPeriod`) refuses the same windows.
    await approveBooking("2027-03-14 22:00:00", "2027-03-14 23:45:00");
    await approveBooking("2027-03-16 00:00:00", "2027-03-16 01:00:00");

    const early = await handleSearchVenues(
      { date: "2027-03-15", startTime: "00:30", endTime: "01:30", location: "East Wing" },
      session(users.coordinator),
      database as never
    );
    expect(early.venues.map(row => row.name)).not.toContain(venueNames[0]);
    expect(early.unsuitable.find(({ venue }) => venue.name === venueNames[0])?.failures).toEqual([
      { criterion: "booking", message: "Booked for another event on 2027-03-14" },
    ]);

    const late = await handleSearchVenues(
      { date: "2027-03-15", startTime: "22:00", endTime: "23:30", location: "East Wing" },
      session(users.coordinator),
      database as never
    );
    expect(late.venues.map(row => row.name)).not.toContain(venueNames[0]);
    expect(late.unsuitable.find(({ venue }) => venue.name === venueNames[0])?.failures).toEqual([
      { criterion: "booking", message: "Booked for another event on 2027-03-16" },
    ]);
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
    // The prefilled venue must match the request's hotel window on the same day.
    expect(result.venues.map(venue => venue.name)).toContain(venueNames[0]);
  });

  it("ignores an event layout preference that names no maintained layout (PTR-161 AC7)", async () => {
    await database
      .update(schema.eventRequests)
      .set({ roomLayoutPreference: "Stadium concert" })
      .where(eq(schema.eventRequests.id, eventId));

    const result = await handleSearchVenues(
      { eventId },
      session(users.coordinator),
      database as never
    );

    expect(result.filters.layout).toBeUndefined();
    expect(result.venues.map(venue => venue.name)).toContain(venueNames[0]);
  });

  it("still refuses an explicitly supplied layout that names no maintained layout", async () => {
    await expect(
      handleSearchVenues(
        { eventId, layout: "Stadium concert" },
        session(users.coordinator),
        database as never
      )
    ).rejects.toThrow(LAYOUT_MESSAGE);
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
    // Reject a window that crosses midnight, regardless of the venue's hours.
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
