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
      ])
      .returning({ id: schema.eventRequests.id });
    [eventId, boundaryEventId] = events.map(event => event.id);

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
      {
        id: "ptr32-pending-other-venue",
        eventId,
        venueId: otherVenueId,
        requestedById: organiser.id,
        assignedStaffId: otherStaff.id,
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
    ]);
  });

  it("returns every pending row in submission order and flags only strict approved overlaps", async () => {
    const requests = await handleListPendingVenueRequests(database as never);

    expect(requests.map(request => request.id)).toEqual([
      "ptr32-pending-overlap",
      "ptr32-pending-other-venue",
      "ptr32-pending-boundary",
    ]);
    expect(requests.map(request => request.conflict)).toEqual([true, false, false]);
    expect(requests[0]).toMatchObject({
      venueName: VENUE_NAMES[0],
      startsAt: "2037-05-10T10:00",
      endsAt: "2037-05-10T11:00",
      submittedAt: new Date("2037-04-02T01:00:00Z"),
    });
    expect(requests[0]).not.toHaveProperty("eventName");
    expect(requests[0]).not.toHaveProperty("conflictingEvent");
  });

  it("maps the live PTR-31 requirement fields and refuses a request after it leaves pending", async () => {
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

    await expect(
      handleGetPendingVenueRequest({ id: "ptr32-pending-overlap" }, database as never)
    ).rejects.toMatchObject({ message: "Not Found" });
  });

  it("does not mutate the pending row while reading its summary or detail", async () => {
    const before = await database
      .select({
        status: schema.venueRequests.status,
        startsAt: schema.venueRequests.startsAt,
        endsAt: schema.venueRequests.endsAt,
        createdAt: schema.venueRequests.createdAt,
      })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, "ptr32-pending-overlap"));

    await handleListPendingVenueRequests(database as never);
    await handleGetPendingVenueRequest({ id: "ptr32-pending-overlap" }, database as never);

    const after = await database
      .select({
        status: schema.venueRequests.status,
        startsAt: schema.venueRequests.startsAt,
        endsAt: schema.venueRequests.endsAt,
        createdAt: schema.venueRequests.createdAt,
      })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, "ptr32-pending-overlap"));

    expect(after).toEqual(before);
  });
});
