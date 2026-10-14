// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { handleGetPendingVenueRequestsForEvent } from "#/features/venue-requests/requests.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

const organiser = {
  id: "ptr32-queue-organiser",
  name: "PTR-32 Queue Organiser",
  email: "ptr32-queue-organiser@example.invalid",
  emailVerified: true,
  role: "event_organiser",
} satisfies typeof schema.user.$inferInsert;

const otherStaff = {
  id: "ptr32-queue-other-staff",
  name: "PTR-32 Queue Other Staff",
  email: "ptr32-queue-other-staff@example.invalid",
  emailVerified: true,
  role: "venue_staff",
} satisfies typeof schema.user.$inferInsert;

const VENUE_NAMES = ["PTR-32 Conflict Hall", "PTR-32 Other Hall"];

const APPROVED_START = "2037-05-10 09:00:00";
const APPROVED_END = "2037-05-10 12:00:00";

describe("pending booking request reader (PTR-32)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let eventId: number;
  let boundaryEventId: number;
  let incompleteEventId: number;
  let conflictVenueId: number;
  let otherVenueId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values([organiser, otherStaff]).onConflictDoNothing();
  });

  afterAll(async () => {
    await database
      .delete(schema.venueRequests)
      .where(eq(schema.venueRequests.requestedById, organiser.id));
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, organiser.id));
    await database.delete(schema.venues).where(inArray(schema.venues.name, VENUE_NAMES));
    await database
      .delete(schema.user)
      .where(inArray(schema.user.id, [organiser.id, otherStaff.id]));
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.venueRequests)
      .where(eq(schema.venueRequests.requestedById, organiser.id));
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, organiser.id));
    await database.delete(schema.venues).where(inArray(schema.venues.name, VENUE_NAMES));

    const insertedVenues = await database
      .insert(schema.venues)
      .values([
        {
          name: VENUE_NAMES[0],
          location: "PTR-32 Wing",
          maxCapacity: 300,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
        {
          name: VENUE_NAMES[1],
          location: "PTR-32 Wing",
          maxCapacity: 200,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
      ])
      .returning({ id: schema.venues.id });
    [conflictVenueId, otherVenueId] = insertedVenues.map(venue => venue.id);

    const events = await database
      .insert(schema.eventRequests)
      .values([
        {
          organiserId: organiser.id,
          status: "submitted",
          submittedAt: new Date("2037-04-01T00:00:00Z"),
          eventName: "PTR-32 Hidden Event Name",
          proposedDates: [{ start: "2037-05-10T09:00", end: "2037-05-10T12:00" }],
          expectedAttendance: null,
          roomLayoutPreference: "Theatre",
          accessibilityRequirements: "Step-free access.\nReserved seating.",
          venueRequirements: "Projector\nTwo wireless microphones",
        },
        {
          organiserId: organiser.id,
          status: "submitted",
          submittedAt: new Date("2037-04-01T00:00:00Z"),
          eventName: "PTR-32 Boundary Event",
          proposedDates: [{ start: "2037-05-10T12:00", end: "2037-05-10T15:00" }],
        },
        {
          organiserId: organiser.id,
          status: "submitted",
          submittedAt: new Date("2037-04-01T00:00:00Z"),
          eventName: "PTR-32 Incomplete Requirements Event",
          // No complete window: the detail read must fall back to "Not yet chosen".
          proposedDates: [{ start: "2037-05-12T09:00" }],
        },
      ])
      .returning({ id: schema.eventRequests.id });
    [eventId, boundaryEventId, incompleteEventId] = events.map(event => event.id);

    await database.insert(schema.venueRequests).values([
      {
        id: "ptr32-approved-booking",
        eventId: boundaryEventId,
        venueId: conflictVenueId,
        requestedById: organiser.id,
        startsAt: APPROVED_START,
        endsAt: APPROVED_END,
        status: "approved",
        createdAt: new Date("2037-04-01T00:00:00Z"),
      },
      {
        id: "ptr32-pending-overlap",
        eventId,
        venueId: conflictVenueId,
        requestedById: organiser.id,
        startsAt: "2037-05-10 10:00:00",
        endsAt: "2037-05-10 11:00:00",
        createdAt: new Date("2037-04-02T01:00:00Z"),
      },
      // Two pending rows share `createdAt`, so the reader must sort by ascending id. Insert the
      // larger id first to prove insertion order does not pass this check.
      {
        id: "ptr32-pending-tie-b",
        eventId: boundaryEventId,
        venueId: otherVenueId,
        requestedById: organiser.id,
        startsAt: APPROVED_START,
        endsAt: APPROVED_END,
        createdAt: new Date("2037-04-02T02:00:00Z"),
      },
      {
        id: "ptr32-pending-tie-a",
        eventId,
        venueId: otherVenueId,
        requestedById: organiser.id,
        startsAt: APPROVED_START,
        endsAt: APPROVED_END,
        createdAt: new Date("2037-04-02T02:00:00Z"),
      },
      {
        id: "ptr32-pending-boundary",
        eventId: boundaryEventId,
        venueId: conflictVenueId,
        requestedById: organiser.id,
        startsAt: APPROVED_END,
        endsAt: "2037-05-10 15:00:00",
        createdAt: new Date("2037-04-02T03:00:00Z"),
      },
      {
        id: "ptr32-withdrawn",
        eventId: boundaryEventId,
        venueId: otherVenueId,
        requestedById: organiser.id,
        startsAt: APPROVED_START,
        endsAt: APPROVED_END,
        status: "withdrawn",
        createdAt: new Date("2037-04-02T04:00:00Z"),
      },
      // The shared queue must include a row assigned to another Venue Staff member. Use the
      // `ptr32assigned-` prefix so the ordering checks above skip this row.
      {
        id: "ptr32assigned-pending",
        eventId: incompleteEventId,
        venueId: conflictVenueId,
        requestedById: organiser.id,
        assignedStaffId: otherStaff.id,
        startsAt: "2037-05-12 09:00:00",
        endsAt: "2037-05-12 12:00:00",
        createdAt: new Date("2037-04-02T05:00:00Z"),
      },
    ]);
  });

  it("returns every pending request of one event in window order, each with its own conflict", async () => {
    const requests = await handleGetPendingVenueRequestsForEvent(
      { eventId },
      { id: otherStaff.id } as never,
      database as never
    );

    // The tie row starts at 09:00 and the overlapping row at 10:00. Rows of other events and the
    // withdrawn row stay out.
    expect(requests.map(request => [request.id, request.conflict])).toEqual([
      ["ptr32-pending-tie-a", null],
      ["ptr32-pending-overlap", "booking"],
    ]);
  });

  it("maps the live PTR-31 requirement fields and drops a request once it leaves pending", async () => {
    const requests = await handleGetPendingVenueRequestsForEvent(
      { eventId },
      { id: otherStaff.id } as never,
      database as never
    );
    const detail = requests.find(request => request.id === "ptr32-pending-overlap");

    expect(detail).toMatchObject({
      id: "ptr32-pending-overlap",
      venueName: VENUE_NAMES[0],
      startsAt: "2037-05-10T10:00",
      endsAt: "2037-05-10T11:00",
      conflict: "booking",
      requirements: {
        eventTiming: "10 May 2037, 09:00 – 12:00",
        expectedAttendance: null,
        layout: "Theatre",
        accessibility: "Step-free access.\nReserved seating.",
        requiredFacilities: "Projector\nTwo wireless microphones",
      },
    });
    // TC12: Venue Staff never receive the event name or the conflicting event.
    for (const request of requests) {
      expect(request).not.toHaveProperty("eventName");
      expect(request).not.toHaveProperty("conflictingEvent");
      expect(JSON.stringify(request)).not.toContain("PTR-32 Hidden Event Name");
      expect(JSON.stringify(request)).not.toContain("PTR-32 Boundary Event");
    }

    await database
      .update(schema.venueRequests)
      .set({ status: "withdrawn" })
      .where(eq(schema.venueRequests.id, "ptr32-pending-overlap"));

    const afterWithdraw = await handleGetPendingVenueRequestsForEvent(
      { eventId },
      { id: otherStaff.id } as never,
      database as never
    );
    expect(afterWithdraw.map(request => request.id)).toEqual(["ptr32-pending-tie-a"]);
  });

  it("surfaces 'Not yet chosen' when the event has no complete proposed window", async () => {
    const [detail] = await handleGetPendingVenueRequestsForEvent(
      { eventId: incompleteEventId },
      { id: otherStaff.id } as never,
      database as never
    );

    expect(detail?.id).toBe("ptr32assigned-pending");
    expect(detail?.requirements.eventTiming).toBe("Not yet chosen");
  });

  it("hides a request assigned to another staff member from the caller", async () => {
    expect(
      await handleGetPendingVenueRequestsForEvent(
        { eventId: incompleteEventId },
        { id: organiser.id } as never,
        database as never
      )
    ).toEqual([]);
  });
});
