// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import {
  handleGetPendingVenueRequest,
  handleListPendingVenueRequests,
} from "#/features/venue-requests/requests.server";
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
      // Two pending rows share a `createdAt`; the reader must fall back to ascending id. The
      // lexically larger id is inserted first, so heap/insertion order cannot produce the asserted
      // order on its own — only the `asc(id)` tie-break can.
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
      // The queue is shared: a row assigned to another Venue Staff member must still be listed.
      // Prefix `ptr32assigned-` so the strict `ptr32-` ordering assertions above skip it.
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

  it("returns exactly the pending rows in submission order, tie-breaking by id, and flags only strict approved overlaps", async () => {
    const requests = await handleListPendingVenueRequests(database as never);
    const pendingIds = [
      "ptr32-pending-overlap",
      "ptr32-pending-tie-a",
      "ptr32-pending-tie-b",
      "ptr32-pending-boundary",
    ];

    // AC4: neither this suite's `approved` nor `withdrawn` fixture may appear in the queue. Other
    // suites seed their own legitimate pending rows (e.g. `demo-venue-request-1`), so the strict
    // order assertions run over only this suite's `ptr32-` fixtures.
    const receivedIds = requests.map(request => request.id);
    expect(receivedIds).not.toContain("ptr32-approved-booking");
    expect(receivedIds).not.toContain("ptr32-withdrawn");

    const ours = requests.filter(request => request.id.startsWith("ptr32-"));
    expect(ours.map(request => request.id)).toEqual(pendingIds);
    expect(ours.map(request => request.conflict)).toEqual([true, false, false, false]);

    // Identical `createdAt`, so only the ascending-id tie-break can order these two.
    const tied = ours.filter(
      request => request.submittedAt.getTime() === new Date("2037-04-02T02:00:00Z").getTime()
    );
    expect(tied.map(request => request.id)).toEqual(["ptr32-pending-tie-a", "ptr32-pending-tie-b"]);

    expect(ours[0]).toMatchObject({
      venueName: VENUE_NAMES[0],
      startsAt: "2037-05-10T10:00",
      endsAt: "2037-05-10T11:00",
      submittedAt: new Date("2037-04-02T01:00:00Z"),
    });
    expect(ours[0]).not.toHaveProperty("eventName");
    expect(ours[0]).not.toHaveProperty("conflictingEvent");
  });

  it("maps the live PTR-31 requirement fields and returns null once the request leaves pending", async () => {
    const detail = await handleGetPendingVenueRequest(
      { id: "ptr32-pending-overlap" },
      database as never
    );

    expect(detail).toMatchObject({
      id: "ptr32-pending-overlap",
      venueName: VENUE_NAMES[0],
      startsAt: "2037-05-10T10:00",
      endsAt: "2037-05-10T11:00",
      conflict: true,
      requirements: {
        eventTiming: "10 May 2037, 09:00 – 12:00",
        expectedAttendance: null,
        layout: "Theatre",
        accessibility: "Step-free access.\nReserved seating.",
        requiredFacilities: "Projector\nTwo wireless microphones",
      },
    });
    expect(detail).not.toHaveProperty("eventName");
    expect(detail).not.toHaveProperty("conflictingEvent");

    await database
      .update(schema.venueRequests)
      .set({ status: "withdrawn" })
      .where(eq(schema.venueRequests.id, "ptr32-pending-overlap"));

    const detailAfterWithdraw = await handleGetPendingVenueRequest(
      { id: "ptr32-pending-overlap" },
      database as never
    );
    expect(detailAfterWithdraw).toBeNull();
  });

  it("lists a pending row assigned to another Venue Staff member (shared queue)", async () => {
    const requests = await handleListPendingVenueRequests(database as never);
    expect(requests.map(request => request.id)).toContain("ptr32assigned-pending");
  });

  it("surfaces 'Not yet chosen' when the event has no complete proposed window", async () => {
    const detail = await handleGetPendingVenueRequest(
      { id: "ptr32assigned-pending" },
      database as never
    );

    expect(detail?.requirements.eventTiming).toBe("Not yet chosen");
  });
});
