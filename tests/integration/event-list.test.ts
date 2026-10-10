// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/**
 * PTR-8 at the `handleListEvents` boundary: which event rows a caller's role and relationships
 * select, and the role-specific projection each one renders through. The middleware pipeline has
 * already established the session before this runs, so the caller here is a `SessionUser` and the
 * only thing under test is the scoping SQL and the projection contract.
 *
 * The fixtures are file-owned so the assertions do not depend on seed state. The one seed row that
 * would otherwise leak in is the attendee demo event (confirmed, registration on), which every
 * attendee sees; the attendee cases therefore find their row by id rather than asserting the
 * whole list length.
 */

type Database = ReturnType<typeof drizzle<typeof schema>>;

const fixtureUsers = {
  organiser: {
    id: "el-organiser",
    name: "Event List Organiser",
    email: "el.organiser@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
  outsider: {
    id: "el-outsider",
    name: "Event List Outsider",
    email: "el.outsider@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
  /**
   * Owns the confirmed fixtures below. A separate organiser keeps the organiser, outsider and
   * coordinator list assertions untouched — those fixtures stay exactly as other roles rely on
   * them — while no list test reads this account, so the attendee-visible rows leak nowhere.
   */
  extraOrganiser: {
    id: "el-extra-organiser",
    name: "Event List Extra Organiser",
    email: "el.extra.organiser@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "el-coordinator",
    name: "Event List Coordinator",
    email: "el.coordinator@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "el-venue-staff",
    name: "Event List Venue Staff",
    email: "el.venue.staff@example.com",
    emailVerified: true,
    role: "venue_staff",
  },
  tech: {
    id: "el-tech",
    name: "Event List Tech Support",
    email: "el.tech@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
  attendee: {
    id: "el-attendee",
    name: "Event List Attendee",
    email: "el.attendee@example.com",
    emailVerified: true,
    role: "attendee",
  },
  attendeeRegistered: {
    id: "el-attendee-registered",
    name: "Event List Registered Attendee",
    email: "el.attendee.registered@example.com",
    emailVerified: true,
    role: "attendee",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const fixtureUserIds = Object.values(fixtureUsers).map(user => user.id);
const organiserIds = [
  fixtureUsers.organiser.id,
  fixtureUsers.outsider.id,
  fixtureUsers.extraOrganiser.id,
];
const attendeeIds = [fixtureUsers.attendee.id, fixtureUsers.attendeeRegistered.id];

const FIXTURE_VENUE_NAME = "Event List Hall";
/**
 * The confirmed fixtures' venue. Separate from the hall above so their approved booking never
 * overlaps the pending rows the PTR-36 conflict test reads.
 */
const FIXTURE_VENUE_2_NAME = "Event List Room 2A";

function session(key: keyof typeof fixtureUsers): SessionUser {
  const user = fixtureUsers[key];
  return { id: user.id, email: user.email, role: user.role };
}

/** A registration window that is open now, and one that closed years before the run. */
const OPEN_WINDOW = {
  registrationOpensAt: "2020-01-01T00:00",
  registrationClosesAt: "2099-01-01T00:00",
};
const CLOSED_WINDOW = {
  registrationOpensAt: "2020-01-01T00:00",
  registrationClosesAt: "2020-02-01T00:00",
};

interface Fixtures {
  main: typeof schema.eventRequests.$inferSelect;
  closed: typeof schema.eventRequests.$inferSelect;
  foreign: typeof schema.eventRequests.$inferSelect;
  draft: typeof schema.eventRequests.$inferSelect;
  review: typeof schema.eventRequests.$inferSelect;
  confirmedOpen: typeof schema.eventRequests.$inferSelect;
  confirmedClosed: typeof schema.eventRequests.$inferSelect;
  confirmedDisabled: typeof schema.eventRequests.$inferSelect;
}

describe("event list handler (PTR-8)", () => {
  let pool: Pool;
  let database: Database;
  let fixtures: Fixtures;
  let fixtureVenueId: number;
  let fixtureVenue2Id: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(fixtureUsers)).onConflictDoNothing();
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: FIXTURE_VENUE_NAME,
        location: "Fixture location",
        maxCapacity: 100,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    fixtureVenueId = venue.id;
    const [venue2] = await database
      .insert(schema.venues)
      .values({
        name: FIXTURE_VENUE_2_NAME,
        location: "Fixture location",
        maxCapacity: 40,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    fixtureVenue2Id = venue2.id;
  });

  afterAll(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
    await database.delete(schema.user).where(inArray(schema.user.id, fixtureUserIds));
    await database
      .delete(schema.venues)
      .where(inArray(schema.venues.id, [fixtureVenueId, fixtureVenue2Id]));
    await pool.end();
  });

  beforeEach(async () => {
    // Children cascade with the events; the registration delete clears only the file-owned rows.
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
    await database
      .delete(schema.eventRegistrations)
      .where(inArray(schema.eventRegistrations.attendeeId, attendeeIds));

    const [main] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: fixtureUsers.coordinator.id,
        assignedAt: new Date(),
        eventName: "Open registration event",
        purpose: "el-purpose",
        description: "el-description",
        proposedDates: [{ start: "2026-10-12T14:30", end: "2026-10-12T18:45" }],
        expectedAttendance: 25,
        roomLayoutPreference: "U-shape",
        accessibilityRequirements: "Step-free access",
        venueRequirements: "Near MRT",
        registrationEnabled: true,
        registrationCapacity: 30,
        ...OPEN_WINDOW,
      })
      .returning();

    const [closed] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: fixtureUsers.coordinator.id,
        assignedAt: new Date(),
        eventName: "Closed registration event",
        proposedDates: [{ start: "2026-11-01T09:00", end: "2026-11-01T12:00" }],
        expectedAttendance: 10,
        registrationEnabled: true,
        registrationCapacity: 10,
        ...CLOSED_WINDOW,
      })
      .returning();

    const [foreign] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.outsider.id,
        status: "submitted",
        submittedAt: new Date(),
        eventName: "Another organiser's event",
      })
      .returning();

    const [draft] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.organiser.id,
        status: "draft",
        eventName: "Not yet an event",
      })
      .returning();

    const [review] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.organiser.id,
        status: "under_review",
        submittedAt: new Date(),
        assignedCoordinatorId: fixtureUsers.coordinator.id,
        assignedAt: new Date(),
        eventName: "Under review event",
        registrationEnabled: true,
        registrationCapacity: 10,
        ...OPEN_WINDOW,
      })
      .returning();

    /**
     * PTR-44: the attendee-visible rows. A browsing attendee sees `confirmed` AND
     * registration-enabled, so these live apart from the `submitted` fixtures other roles'
     * tests rely on. They belong to the extra organiser with no assigned coordinator, so no
     * organiser, outsider or coordinator list assertion sees them. `confirmed` carries the
     * decision and confirmation attribution the CHECKs require.
     */
    const confirmedAttribution = {
      submittedAt: new Date(),
      decidedByCoordinatorId: fixtureUsers.coordinator.id,
      decidedByCoordinatorName: fixtureUsers.coordinator.name,
      decidedAt: new Date(),
      confirmedById: fixtureUsers.coordinator.id,
      confirmedByName: fixtureUsers.coordinator.name,
      confirmedAt: new Date(),
    };

    const [confirmedOpen] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.extraOrganiser.id,
        status: "confirmed",
        eventName: "Confirmed open event",
        purpose: "el-purpose",
        description: "el-confirmed-description",
        proposedDates: [{ start: "2026-12-05T10:00", end: "2026-12-05T15:00" }],
        expectedAttendance: 50,
        roomLayoutPreference: "Theatre",
        accessibilityRequirements: "Step-free access",
        venueRequirements: "Near MRT",
        registrationEnabled: true,
        registrationCapacity: 60,
        ...OPEN_WINDOW,
        ...confirmedAttribution,
      })
      .returning();

    // A closed window stays visible: the window gates the registration action, not the view.
    // No approved booking, so its venue reads null.
    const [confirmedClosed] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.extraOrganiser.id,
        status: "confirmed",
        eventName: "Confirmed closed-window event",
        description: "el-confirmed-closed-description",
        proposedDates: [{ start: "2026-12-06T10:00", end: "2026-12-06T12:00" }],
        registrationEnabled: true,
        registrationCapacity: 60,
        ...CLOSED_WINDOW,
        ...confirmedAttribution,
      })
      .returning();

    // Registration off means no terms at all (the CHECK refuses anything else) and no view.
    const [confirmedDisabled] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.extraOrganiser.id,
        status: "confirmed",
        eventName: "Confirmed registration-off event",
        description: "el-confirmed-disabled-description",
        proposedDates: [{ start: "2026-12-07T10:00", end: "2026-12-07T12:00" }],
        registrationEnabled: false,
        ...confirmedAttribution,
      })
      .returning();

    await database.insert(schema.venueRequests).values([
      {
        // Sorts before the pending row; with the fallback gone it must not reach the card, and the
        // pending row below is the only one the assertion sees (PTR-31 AC5).
        id: "el-venue-0-withdrawn",
        eventId: main.id,
        venueId: fixtureVenueId,
        requestedById: fixtureUsers.coordinator.id,
        startsAt: "2026-10-12 09:00:00",
        endsAt: "2026-10-12 10:00:00",
        assignedStaffId: fixtureUsers.venueStaff.id,
        status: "withdrawn",
      },
      {
        id: "el-venue-main",
        eventId: main.id,
        venueId: fixtureVenueId,
        requestedById: fixtureUsers.coordinator.id,
        startsAt: "2026-10-12 14:30:00",
        endsAt: "2026-10-12 18:45:00",
        assignedStaffId: fixtureUsers.venueStaff.id,
      },
      {
        id: "el-venue-review",
        eventId: review.id,
        venueId: fixtureVenueId,
        requestedById: fixtureUsers.coordinator.id,
        startsAt: "2026-11-01 09:00:00",
        endsAt: "2026-11-01 12:00:00",
        assignedStaffId: fixtureUsers.venueStaff.id,
      },
      {
        // The closed event's only request is withdrawn, so its card shows no venue request.
        id: "el-venue-closed-withdrawn",
        eventId: closed.id,
        venueId: fixtureVenueId,
        requestedById: fixtureUsers.coordinator.id,
        startsAt: "2026-11-01 09:00:00",
        endsAt: "2026-11-01 12:00:00",
        status: "withdrawn",
      },
      {
        // The booking the open confirmed event was confirmed against (PTR-44 AC2): unassigned
        // and approved, so it reaches no staff queue and only the attendee venue lookup reads it.
        id: "el-venue-confirmed-open",
        eventId: confirmedOpen.id,
        venueId: fixtureVenue2Id,
        requestedById: fixtureUsers.coordinator.id,
        startsAt: "2026-12-05 10:00:00",
        endsAt: "2026-12-05 15:00:00",
        status: "approved",
      },
    ]);

    await database.insert(schema.equipmentRequests).values([
      {
        id: "el-equipment-ours",
        eventId: main.id,
        assignedStaffId: fixtureUsers.tech.id,
        item: "Projector",
        quantity: 1,
        arrangementStatus: "reserved",
        notes: "HDMI adapter included",
      },
      {
        // Assigned to nobody: a technician connected through one line still sees every line.
        id: "el-equipment-other",
        eventId: main.id,
        item: "Microphone",
        quantity: 1,
      },
      {
        id: "el-equipment-review",
        eventId: review.id,
        assignedStaffId: fixtureUsers.tech.id,
        item: "Projector",
        quantity: 1,
      },
    ]);

    await database.insert(schema.eventRegistrations).values([
      {
        eventId: closed.id,
        attendeeId: fixtureUsers.attendeeRegistered.id,
        registeredAt: new Date("2026-01-02T03:04:05Z"),
      },
      {
        eventId: review.id,
        attendeeId: fixtureUsers.attendeeRegistered.id,
        registeredAt: new Date("2026-02-03T04:05:06Z"),
      },
    ]);

    fixtures = {
      main,
      closed,
      foreign,
      draft,
      review,
      confirmedOpen,
      confirmedClosed,
      confirmedDisabled,
    };
  });

  function insertRejected(
    id: string,
    values: Partial<typeof schema.venueRequests.$inferInsert> = {}
  ) {
    return database.insert(schema.venueRequests).values({
      id,
      eventId: fixtures.closed.id,
      venueId: fixtureVenueId,
      requestedById: fixtureUsers.coordinator.id,
      assignedStaffId: fixtureUsers.venueStaff.id,
      startsAt: "2026-11-01 09:00:00",
      endsAt: "2026-11-01 12:00:00",
      status: "rejected",
      rejectionReason: "Closed for floor resurfacing",
      ...values,
    });
  }

  async function coordinatorCard(eventId: number) {
    const [projection] = await handleListEvents(
      { eventId },
      session("coordinator"),
      database as never
    );
    return projection.event.venueRequest;
  }

  describe("role scoping over the bare list", () => {
    it("shows an organiser every non-draft event of theirs and never their draft", async () => {
      const listed = await handleListEvents({}, session("organiser"), database as never);

      expect(listed.map(row => row.event.id).toSorted((a, b) => a - b)).toEqual(
        [fixtures.main.id, fixtures.closed.id, fixtures.review.id].toSorted((a, b) => a - b)
      );
      expect(listed.every(row => row.access === "organiser")).toBe(true);
    });

    it("shows a Coordinator only the events assigned to them", async () => {
      const listed = await handleListEvents({}, session("coordinator"), database as never);

      expect(listed.map(row => row.event.id).toSorted((a, b) => a - b)).toEqual(
        [fixtures.main.id, fixtures.closed.id, fixtures.review.id].toSorted((a, b) => a - b)
      );
      expect(listed.every(row => row.access === "coordinator")).toBe(true);
    });

    it("shows Venue Staff the events with a venue request assigned to them, and nobody else's", async () => {
      const listed = await handleListEvents({}, session("venueStaff"), database as never);

      expect(listed.map(row => row.event.id).toSorted((a, b) => a - b)).toEqual(
        [fixtures.main.id, fixtures.review.id].toSorted((a, b) => a - b)
      );
      expect(listed[0].access).toBe("venue_staff");
    });

    it("shows Technical Support the events with an equipment request assigned to them", async () => {
      const listed = await handleListEvents({}, session("tech"), database as never);

      expect(listed.map(row => row.event.id).toSorted((a, b) => a - b)).toEqual(
        [fixtures.main.id, fixtures.review.id].toSorted((a, b) => a - b)
      );
      expect(listed[0].access).toBe("technical_support");
    });

    it("shows an organiser with no connection only their own event, never someone else's", async () => {
      const listed = await handleListEvents({}, session("outsider"), database as never);

      expect(listed.map(row => row.event.id)).toEqual([fixtures.foreign.id]);
    });

    it("answers an unrecognised role with nothing rather than everything", async () => {
      const ghost: SessionUser = {
        id: "el-ghost",
        email: "ghost@example.com",
        role: "wizard",
      };

      expect(await handleListEvents({}, ghost, database as never)).toEqual([]);
    });
  });

  describe("the role-specific projection", () => {
    it("shows each Attendee their own status and the amended booking", async () => {
      const eventId = fixtures.confirmedOpen.id;
      await database
        .update(schema.venueRequests)
        .set({
          venueId: fixtureVenueId,
          startsAt: "2026-12-09 11:30:00",
          endsAt: "2026-12-09 14:45:00",
        })
        .where(eq(schema.venueRequests.id, "el-venue-confirmed-open"));
      await database.insert(schema.eventRegistrations).values([
        {
          eventId,
          attendeeId: fixtureUsers.attendeeRegistered.id,
          status: "registered",
        },
        {
          eventId,
          attendeeId: fixtureUsers.attendee.id,
          status: "withdrawn",
        },
        {
          eventId: fixtures.confirmedClosed.id,
          attendeeId: fixtureUsers.attendee.id,
          status: "registered",
        },
      ]);

      const [registeredProjection] = await handleListEvents(
        { eventId },
        session("attendeeRegistered"),
        database as never
      );
      const [withdrawnProjection] = await handleListEvents(
        { eventId },
        session("attendee"),
        database as never
      );

      expect(registeredProjection.event).toMatchObject({
        registration: { status: "registered" },
        venue: {
          name: FIXTURE_VENUE_NAME,
          location: "Fixture location",
          date: "2026-12-09",
          startTime: "11:30",
          endTime: "14:45",
        },
      });
      expect(withdrawnProjection.event.registration?.status).toBe("withdrawn");
    });

    it("shows a registered Attendee the current venue for a cancelled event, with no places", async () => {
      const eventId = fixtures.confirmedOpen.id;
      await database
        .update(schema.eventRequests)
        .set({
          status: "cancelled",
          cancelledById: fixtureUsers.coordinator.id,
          cancelledByName: fixtureUsers.coordinator.name,
          cancelledAt: new Date(),
        })
        .where(eq(schema.eventRequests.id, eventId));
      await database
        .update(schema.venueRequests)
        .set({
          startsAt: "2026-12-08 11:30:00",
          endsAt: "2026-12-08 14:45:00",
        })
        .where(eq(schema.venueRequests.id, "el-venue-confirmed-open"));
      await database.insert(schema.eventRegistrations).values([
        {
          eventId,
          attendeeId: fixtureUsers.attendeeRegistered.id,
          status: "registered",
        },
        {
          eventId,
          attendeeId: fixtureUsers.attendee.id,
          status: "withdrawn",
        },
        {
          eventId: fixtures.confirmedClosed.id,
          attendeeId: fixtureUsers.attendeeRegistered.id,
          status: "registered",
        },
      ]);

      const [registeredProjection] = await handleListEvents(
        { eventId },
        session("attendeeRegistered"),
        database as never
      );
      const [withdrawnProjection] = await handleListEvents(
        { eventId },
        session("attendee"),
        database as never
      );

      expect(registeredProjection.event).toMatchObject({
        status: "cancelled",
        registration: { status: "registered" },
        places: null,
        venue: {
          name: FIXTURE_VENUE_2_NAME,
          date: "2026-12-08",
          startTime: "11:30",
          endTime: "14:45",
        },
      });
      expect(withdrawnProjection.event.registration?.status).toBe("withdrawn");
    });

    it("gives an organiser the full record, their equipment and the venue request", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("organiser"),
        database as never
      );

      expect(projection.access).toBe("organiser");
      expect(projection.event).toMatchObject({
        id: fixtures.main.id,
        name: "Open registration event",
        description: "el-description",
        status: "submitted",
        eventDate: "2026-10-12",
        startTime: "14:30",
        endTime: "18:45",
        expectedAttendance: 25,
        layout: "U-shape",
        accessibilityRequirements: "Step-free access",
        requiredFacilities: "Near MRT",
        registrationOpensAt: OPEN_WINDOW.registrationOpensAt,
        registrationClosesAt: OPEN_WINDOW.registrationClosesAt,
        venueRequest: { status: "pending" },
      });
      expect(projection.event).not.toHaveProperty("registration");
      expect(projection.event.equipment?.map(item => item.item).toSorted()).toEqual([
        "Microphone",
        "Projector",
      ]);
    });

    it("shows no venue request once the only one is withdrawn (PTR-31 AC5)", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.closed.id },
        session("organiser"),
        database as never
      );

      expect(projection.event.venueRequest).toBeNull();
    });

    it("gives a Coordinator the same full record as the organiser", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("coordinator"),
        database as never
      );

      expect(projection.access).toBe("coordinator");
      expect(projection.event).toMatchObject({
        name: "Open registration event",
        status: "submitted",
        expectedAttendance: 25,
        venueRequest: { status: "pending" },
      });
      expect(projection.event.equipment).toHaveLength(2);
    });

    it("gives Venue Staff the operational fields and their venue request, with no event name", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("venueStaff"),
        database as never
      );

      expect(projection.access).toBe("venue_staff");
      expect(projection.event).toMatchObject({
        id: fixtures.main.id,
        eventDate: "2026-10-12",
        startTime: "14:30",
        endTime: "18:45",
        expectedAttendance: 25,
        layout: "U-shape",
        accessibilityRequirements: "Step-free access",
        requiredFacilities: "Near MRT",
        venueRequest: { status: "pending" },
      });
      // PTR-31 criterion 2: not even the name, and none of the organiser-only fields.
      expect(projection.event).not.toHaveProperty("name");
      expect(projection.event).not.toHaveProperty("description");
      // Everyone with access sees the stage.
      expect(projection.event.status).toBe("submitted");
      expect(projection.event).not.toHaveProperty("equipment");
    });

    it("flags a pending request that overlaps an approved booking, and only that one (PTR-36 AC4)", async () => {
      await database.insert(schema.venueRequests).values({
        id: "el-venue-approved",
        eventId: fixtures.review.id,
        venueId: fixtureVenueId,
        requestedById: fixtureUsers.coordinator.id,
        assignedStaffId: fixtureUsers.venueStaff.id,
        startsAt: "2026-10-12 15:00:00",
        endsAt: "2026-10-12 16:00:00",
        status: "approved",
      });

      const [flagged] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("venueStaff"),
        database as never
      );
      expect(flagged.event.venueRequest).toEqual({
        id: "el-venue-main",
        status: "pending",
        venueName: FIXTURE_VENUE_NAME,
        conflict: "booking",
      });

      const [clear] = await handleListEvents(
        { eventId: fixtures.review.id },
        session("venueStaff"),
        database as never
      );
      expect(clear.event.venueRequest).toEqual({
        id: "el-venue-review",
        status: "pending",
        venueName: FIXTURE_VENUE_NAME,
      });
    });

    it("carries the requested venue's name on Venue Staff's pending request", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("venueStaff"),
        database as never
      );

      expect(projection.event.venueRequest).toEqual({
        id: "el-venue-main",
        status: "pending",
        venueName: FIXTURE_VENUE_NAME,
      });
    });

    it("shows Venue Staff their settled approved request with the venue name", async () => {
      await database
        .update(schema.venueRequests)
        .set({ status: "approved" })
        .where(eq(schema.venueRequests.id, "el-venue-main"));

      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("venueStaff"),
        database as never
      );

      expect(projection.event.venueRequest).toEqual({
        id: "el-venue-main",
        status: "approved",
        venueName: FIXTURE_VENUE_NAME,
      });
      expect(projection.event).not.toHaveProperty("name");
    });

    it("shows Venue Staff their settled rejected request with its reason", async () => {
      await database
        .update(schema.venueRequests)
        .set({ status: "rejected", rejectionReason: "Closed for floor resurfacing" })
        .where(eq(schema.venueRequests.id, "el-venue-main"));

      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("venueStaff"),
        database as never
      );

      expect(projection.event.venueRequest).toEqual({
        id: "el-venue-main",
        status: "rejected",
        venueName: FIXTURE_VENUE_NAME,
        rejection: {
          venueId: fixtureVenueId,
          venueName: FIXTURE_VENUE_NAME,
          date: "2026-10-12",
          startTime: "14:30",
          endTime: "18:45",
          reason: "Closed for floor resurfacing",
          suggestion: null,
          suggestedVenueId: null,
        },
      });
    });

    it("shows Venue Staff their settled released request with its reason", async () => {
      await database
        .update(schema.venueRequests)
        .set({ status: "released", releaseReason: "Air-conditioning failure" })
        .where(eq(schema.venueRequests.id, "el-venue-main"));

      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("venueStaff"),
        database as never
      );

      expect(projection.event.venueRequest).toEqual({
        id: "el-venue-main",
        status: "released",
        venueName: FIXTURE_VENUE_NAME,
        release: {
          venueName: FIXTURE_VENUE_NAME,
          date: "2026-10-12",
          startTime: "14:30",
          endTime: "18:45",
          reason: "Air-conditioning failure",
          changedByName: null,
        },
      });
    });

    it("keeps a pending request on a cancelled event so Venue Staff still see it", async () => {
      await database
        .update(schema.eventRequests)
        .set({
          status: "cancelled",
          cancelledById: fixtureUsers.coordinator.id,
          cancelledByName: fixtureUsers.coordinator.name,
          cancelledAt: new Date(),
        })
        .where(eq(schema.eventRequests.id, fixtures.main.id));

      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("venueStaff"),
        database as never
      );

      expect(projection.event.venueRequest).toEqual({
        id: "el-venue-main",
        status: "pending",
        venueName: FIXTURE_VENUE_NAME,
      });
    });

    describe("a rejected venue request (PTR-34 AC3)", () => {
      it("shows the requesting Coordinator the rejection, its reason and the suggestion", async () => {
        await insertRejected("el-venue-rejected-full", {
          suggestedVenueId: fixtureVenueId,
          suggestedDate: "2026-11-02",
          suggestedStartTime: "10:00",
          suggestedEndTime: "13:30",
        });

        expect(await coordinatorCard(fixtures.closed.id)).toEqual({
          id: "el-venue-rejected-full",
          status: "rejected",
          venueName: FIXTURE_VENUE_NAME,
          rejection: {
            venueId: fixtureVenueId,
            venueName: FIXTURE_VENUE_NAME,
            date: "2026-11-01",
            startTime: "09:00",
            endTime: "12:00",
            reason: "Closed for floor resurfacing",
            suggestion: {
              venueName: FIXTURE_VENUE_NAME,
              date: "2026-11-02",
              startTime: "10:00",
              endTime: "13:30",
            },
            suggestedVenueId: fixtureVenueId,
          },
        });
      });

      it("reports no suggestion when Venue Staff gave none, and only the parts they gave", async () => {
        await insertRejected("el-venue-rejected-bare");
        expect(await coordinatorCard(fixtures.closed.id)).toEqual({
          id: "el-venue-rejected-bare",
          status: "rejected",
          venueName: FIXTURE_VENUE_NAME,
          rejection: {
            venueId: fixtureVenueId,
            venueName: FIXTURE_VENUE_NAME,
            date: "2026-11-01",
            startTime: "09:00",
            endTime: "12:00",
            reason: "Closed for floor resurfacing",
            suggestion: null,
            suggestedVenueId: null,
          },
        });

        await database
          .update(schema.venueRequests)
          .set({ suggestedDate: "2026-11-02" })
          .where(eq(schema.venueRequests.id, "el-venue-rejected-bare"));
        expect(await coordinatorCard(fixtures.closed.id)).toMatchObject({
          rejection: {
            suggestion: {
              venueName: null,
              date: "2026-11-02",
              startTime: null,
              endTime: null,
            },
          },
        });
      });

      it("keeps the last rejection beside a pending request (PTR-35 AC3)", async () => {
        await insertRejected("el-venue-rejected-old", {
          eventId: fixtures.main.id,
        });

        // The card reads pending, and the rejection it answers rides along in full.
        expect(await coordinatorCard(fixtures.main.id)).toEqual({
          id: "el-venue-main",
          status: "pending",
          venueName: FIXTURE_VENUE_NAME,
          rejection: {
            venueId: fixtureVenueId,
            venueName: FIXTURE_VENUE_NAME,
            date: "2026-11-01",
            startTime: "09:00",
            endTime: "12:00",
            reason: "Closed for floor resurfacing",
            suggestion: null,
            suggestedVenueId: null,
          },
        });
      });

      it("shows the most recently decided rejection", async () => {
        await insertRejected("el-venue-rejected-a", {
          rejectionReason: "First reason",
          updatedAt: new Date("2026-10-01T00:00:00Z"),
        });
        await insertRejected("el-venue-rejected-b", {
          rejectionReason: "Latest reason",
          updatedAt: new Date("2026-10-03T00:00:00Z"),
        });
        await insertRejected("el-venue-rejected-c", {
          rejectionReason: "Middle reason",
          updatedAt: new Date("2026-10-02T00:00:00Z"),
        });

        expect(await coordinatorCard(fixtures.closed.id)).toMatchObject({
          rejection: { reason: "Latest reason" },
        });
      });

      it("does not show a stale rejection once a newer request has settled differently", async () => {
        await insertRejected("el-venue-rejected-superseded", {
          updatedAt: new Date("2026-10-01T00:00:00Z"),
        });
        await database.insert(schema.venueRequests).values({
          id: "el-venue-approved-after-rejection",
          eventId: fixtures.closed.id,
          venueId: fixtureVenueId,
          requestedById: fixtureUsers.coordinator.id,
          assignedStaffId: fixtureUsers.venueStaff.id,
          startsAt: "2026-11-05 09:00:00",
          endsAt: "2026-11-05 12:00:00",
          status: "approved",
          updatedAt: new Date("2026-10-05T00:00:00Z"),
        });

        // The event's newest venue request is now the approval, not the earlier rejection, so the
        // rejection must not still render as the event's live state (PTR-34 review: a rejected then
        // raised-and-approved request must not resurrect its old reason).
        expect(await coordinatorCard(fixtures.closed.id)).toBeNull();
      });

      it("shows a released booking instead of resurfacing an older rejection", async () => {
        await insertRejected("el-venue-rejected-before-release", {
          updatedAt: new Date("2026-10-01T00:00:00Z"),
        });
        await database.insert(schema.venueRequests).values({
          id: "el-venue-released-after-rejection",
          eventId: fixtures.closed.id,
          venueId: fixtureVenueId,
          requestedById: fixtureUsers.coordinator.id,
          assignedStaffId: fixtureUsers.venueStaff.id,
          startsAt: "2026-11-05 09:00:00",
          endsAt: "2026-11-05 12:00:00",
          status: "released",
          releaseReason: "Air-conditioning failure",
          lastChangedByStaffId: fixtureUsers.venueStaff.id,
          lastChangedByStaffName: fixtureUsers.venueStaff.name,
          lastChangedAt: new Date("2026-10-05T00:00:00Z"),
          updatedAt: new Date("2026-10-05T00:00:00Z"),
        });

        expect(await coordinatorCard(fixtures.closed.id)).toEqual({
          id: "el-venue-released-after-rejection",
          status: "released",
          venueName: FIXTURE_VENUE_NAME,
          release: {
            venueName: FIXTURE_VENUE_NAME,
            date: "2026-11-05",
            startTime: "09:00",
            endTime: "12:00",
            reason: "Air-conditioning failure",
            changedByName: fixtureUsers.venueStaff.name,
          },
        });
      });

      it("keeps the rejection when the replacement request is withdrawn", async () => {
        await insertRejected("el-venue-rejected-then-withdrawn", {
          updatedAt: new Date("2026-10-01T00:00:00Z"),
        });
        await database.insert(schema.venueRequests).values({
          id: "el-venue-withdrawn-after-rejection",
          eventId: fixtures.closed.id,
          venueId: fixtureVenueId,
          requestedById: fixtureUsers.coordinator.id,
          startsAt: "2026-11-06 09:00:00",
          endsAt: "2026-11-06 12:00:00",
          status: "withdrawn",
          updatedAt: new Date("2026-10-05T00:00:00Z"),
        });

        // A withdrawal carries no decision, so the Coordinator is back to planning and the last
        // rejection is still the event's live state (PTR-34 review).
        expect(await coordinatorCard(fixtures.closed.id)).toMatchObject({
          status: "rejected",
          rejection: { reason: "Closed for floor resurfacing" },
        });
      });

      it("leaves the organiser's view as it was, with no rejection and no reason", async () => {
        await insertRejected("el-venue-rejected-org");

        const [projection] = await handleListEvents(
          { eventId: fixtures.closed.id },
          session("organiser"),
          database as never
        );

        expect(projection.event.venueRequest).toBeNull();
      });
    });

    it("gives Technical Support every equipment line of the event, not only their own", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("tech"),
        database as never
      );

      expect(projection.access).toBe("technical_support");
      expect(projection.event).toMatchObject({
        id: fixtures.main.id,
        name: "Open registration event",
      });
      expect(projection.event.equipment).toEqual(
        expect.arrayContaining([
          {
            id: "el-equipment-ours",
            item: "Projector",
            arrangementStatus: "reserved",
            notes: "HDMI adapter included",
            quantity: 1,
            arrangementNotes: null,
            unavailableReason: null,
            reservedQuantity: null,
            lastRelease: null,
            arrangeable: true,
            assignedStaffName: "Event List Tech Support",
          },
          {
            id: "el-equipment-other",
            item: "Microphone",
            arrangementStatus: "requested",
            notes: null,
            quantity: 1,
            arrangementNotes: null,
            unavailableReason: null,
            reservedQuantity: null,
            lastRelease: null,
            // Unassigned, on an event not yet submitted: shown, but not open to this member.
            arrangeable: false,
            assignedStaffName: null,
          },
        ])
      );
      expect(projection.event).not.toHaveProperty("expectedAttendance");
      expect(projection.event).not.toHaveProperty("venueRequest");
    });

    it("gives an unregistered attendee the PTR-44 fields, the venue, and no internal planning information", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.confirmedOpen.id },
        session("attendee"),
        database as never
      );

      expect(projection.access).toBe("attendee");
      expect(projection.event).toMatchObject({
        id: fixtures.confirmedOpen.id,
        name: "Confirmed open event",
        description: "el-confirmed-description",
        eventDate: "2026-12-05",
        startTime: "10:00",
        endTime: "15:00",
        registrationOpensAt: OPEN_WINDOW.registrationOpensAt,
        registrationClosesAt: OPEN_WINDOW.registrationClosesAt,
        registration: null,
        // PTR-45 AC10: registration capacity 60 at a 40-seat venue, so the venue sets the limit.
        places: { registered: 0, limit: 40 },
        // PTR-50: inside the open window with places left.
        registrationAvailability: { state: "open" },
        venue: {
          name: FIXTURE_VENUE_2_NAME,
          location: "Fixture location",
          date: "2026-12-05",
          endDate: "2026-12-05",
          startTime: "10:00",
          endTime: "15:00",
        },
      });
      // Everyone with access sees the stage.
      expect(projection.event.status).toBe("confirmed");
      // AC3: no booking decisions, equipment, or clarification threads — and no confirmation
      // record either (PTR-24 withholds it from attendees).
      expect(Object.keys(projection.event).toSorted()).toEqual(
        [
          "description",
          "endDate",
          "endTime",
          "eventDate",
          "id",
          "name",
          "places",
          "registration",
          "registrationAvailability",
          "registrationClosesAt",
          "registrationEnabled",
          "registrationOpensAt",
          "startTime",
          "status",
          "venue",
        ].toSorted()
      );
    });

    it("counts only registered places for an attendee (PTR-45 AC10)", async () => {
      await database.insert(schema.eventRegistrations).values([
        { eventId: fixtures.confirmedOpen.id, attendeeId: fixtureUsers.attendeeRegistered.id },
        {
          eventId: fixtures.confirmedOpen.id,
          attendeeId: fixtureUsers.outsider.id,
          status: "withdrawn",
        },
      ]);

      const [projection] = await handleListEvents(
        { eventId: fixtures.confirmedOpen.id },
        session("attendee"),
        database as never
      );

      expect(projection.event.places).toEqual({ registered: 1, vip: 0, limit: 40, capacity: 60 });
    });

    it("keeps the earliest-created approved booking when a later one exists (determinism)", async () => {
      // A different venue from the first booking, so the ADR-5 overlap rule cannot fire; the
      // explicitly later createdAt proves the earliest-created booking wins, not the newest row.
      await database.insert(schema.venueRequests).values({
        id: "el-venue-confirmed-open-second",
        eventId: fixtures.confirmedOpen.id,
        venueId: fixtureVenueId,
        requestedById: fixtureUsers.coordinator.id,
        startsAt: "2026-12-05 10:00:00",
        endsAt: "2026-12-05 15:00:00",
        status: "approved",
        createdAt: new Date(Date.now() + 60_000),
      });

      const [projection] = await handleListEvents(
        { eventId: fixtures.confirmedOpen.id },
        session("attendee"),
        database as never
      );
      expect(projection.event.venue).toMatchObject({
        name: FIXTURE_VENUE_2_NAME,
        date: "2026-12-05",
      });
    });

    it("shows no venue once the approved booking is released (PTR-24 AC6)", async () => {
      await database
        .update(schema.venueRequests)
        .set({ status: "released", releaseReason: "Air-conditioning failure" })
        .where(eq(schema.venueRequests.id, "el-venue-confirmed-open"));

      const [projection] = await handleListEvents(
        { eventId: fixtures.confirmedOpen.id },
        session("attendee"),
        database as never
      );
      expect(projection.event.venue).toBeNull();
      // Without a venue there is no place limit, so no count either.
      expect(projection.event.places).toBeNull();
    });

    it("keeps a confirmed event visible after its registration window has closed (PTR-44: the window gates the action, not the view)", async () => {
      const listed = await handleListEvents({}, session("attendee"), database as never);

      expect(listed.map(row => row.event.id)).toContain(fixtures.confirmedClosed.id);

      const [projection] = await handleListEvents(
        { eventId: fixtures.confirmedClosed.id },
        session("attendee"),
        database as never
      );
      expect(projection.access).toBe("attendee");
      expect(projection.event.venue).toBeNull();
    });

    it("keeps a confirmed event with registration off out of an attendee's list and refuses it by id", async () => {
      const listed = await handleListEvents({}, session("attendee"), database as never);

      expect(listed.map(row => row.event.id)).not.toContain(fixtures.confirmedDisabled.id);
      await expect(
        handleListEvents(
          { eventId: fixtures.confirmedDisabled.id },
          session("attendee"),
          database as never
        )
      ).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
    });

    it("keeps a submitted event out of an attendee's list and refuses it by id (PTR-44: submitted is no longer the stand-in)", async () => {
      const listed = await handleListEvents({}, session("attendee"), database as never);

      expect(listed.map(row => row.event.id)).toContain(fixtures.confirmedOpen.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.main.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.closed.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.foreign.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.draft.id);
      await expect(
        handleListEvents({ eventId: fixtures.main.id }, session("attendee"), database as never)
      ).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
    });

    it("keeps an event visible to an attendee whose own registration outlives the closed window", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.closed.id },
        session("attendeeRegistered"),
        database as never
      );

      expect(projection.access).toBe("attendee");
      expect(projection.event.registration).toEqual({
        status: "registered",
        registeredAt: "2026-01-02T03:04:05.000Z",
      });
    });

    it("keeps an under-review event out of an attendee's list and refuses it by id", async () => {
      const listed = await handleListEvents({}, session("attendee"), database as never);

      expect(listed.map(row => row.event.id)).toContain(fixtures.confirmedOpen.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.review.id);
      await expect(
        handleListEvents({ eventId: fixtures.review.id }, session("attendee"), database as never)
      ).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
    });

    it("keeps an under-review event visible to an attendee who already registered", async () => {
      const listed = await handleListEvents({}, session("attendeeRegistered"), database as never);

      expect(listed.map(row => row.event.id)).toContain(fixtures.review.id);

      const [projection] = await handleListEvents(
        { eventId: fixtures.review.id },
        session("attendeeRegistered"),
        database as never
      );
      expect(projection.access).toBe("attendee");
      expect(projection.event.registration).toEqual({
        status: "registered",
        registeredAt: "2026-02-03T04:05:06.000Z",
      });
    });
  });

  describe("naming one event", () => {
    it("returns exactly the named event when the caller is connected to it", async () => {
      const listed = await handleListEvents(
        { eventId: fixtures.foreign.id },
        session("outsider"),
        database as never
      );

      expect(listed.map(row => row.event.id)).toEqual([fixtures.foreign.id]);
    });

    it("refuses a named event the caller is not connected to", async () => {
      await expect(
        handleListEvents({ eventId: fixtures.foreign.id }, session("organiser"), database as never)
      ).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
    });

    it("refuses a named draft even in the caller's own account, like any unavailable event", async () => {
      await expect(
        handleListEvents({ eventId: fixtures.draft.id }, session("organiser"), database as never)
      ).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
    });

    it("refuses an id that is not a positive whole number before any query", async () => {
      await expect(
        handleListEvents({ eventId: "41" }, session("organiser"), database as never)
      ).rejects.toThrow("Choose an event");
    });
  });

  it("names every event an organiser can see in the same order for the list and the detail", async () => {
    const listed = await handleListEvents({}, session("organiser"), database as never);
    const detailed = await Promise.all(
      listed.map(row =>
        handleListEvents({ eventId: row.event.id }, session("organiser"), database as never)
      )
    );

    expect(
      listed.map(row => row.event.name).toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))
    ).toEqual(["Closed registration event", "Open registration event", "Under review event"]);
    expect(detailed.map(rows => rows.map(row => row.event.name))).toEqual(
      listed.map(row => [row.event.name])
    );
  });
});
