// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";

/**
 * PTR-8 at the `handleListEvents` boundary: which event rows a caller's role and relationships
 * select, and the role-specific projection each one renders through. The middleware pipeline has
 * already established the session before this runs, so the caller here is a `SessionUser` and the
 * only thing under test is the scoping SQL and the projection contract.
 *
 * The fixtures are file-owned so the assertions do not depend on seed state. The one seed row that
 * would otherwise leak in is the registration-enabled demo event, which every attendee sees; the
 * attendee cases therefore find their row by id rather than asserting the whole list length.
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
const organiserIds = [fixtureUsers.organiser.id, fixtureUsers.outsider.id];
const attendeeIds = [fixtureUsers.attendee.id, fixtureUsers.attendeeRegistered.id];

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
}

describe("event list handler (PTR-8)", () => {
  let pool: Pool;
  let database: Database;
  let fixtures: Fixtures;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(fixtureUsers)).onConflictDoNothing();
  });

  afterAll(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, organiserIds));
    await database.delete(schema.user).where(inArray(schema.user.id, fixtureUserIds));
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

    await database.insert(schema.venueRequests).values([
      {
        id: "el-venue-main",
        eventId: main.id,
        assignedStaffId: fixtureUsers.venueStaff.id,
      },
      {
        id: "el-venue-review",
        eventId: review.id,
        assignedStaffId: fixtureUsers.venueStaff.id,
      },
    ]);

    await database.insert(schema.equipmentRequests).values([
      {
        id: "el-equipment-ours",
        eventId: main.id,
        assignedStaffId: fixtureUsers.tech.id,
        item: "Projector",
        arrangementStatus: "reserved",
        notes: "HDMI adapter included",
      },
      {
        // Assigned to nobody: a technician connected through one line still sees every line.
        id: "el-equipment-other",
        eventId: main.id,
        item: "Microphone",
      },
      {
        id: "el-equipment-review",
        eventId: review.id,
        assignedStaffId: fixtureUsers.tech.id,
        item: "Projector",
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

    fixtures = { main, closed, foreign, draft, review };
  });

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
      const ghost: SessionUser = { id: "el-ghost", email: "ghost@example.com", role: "wizard" };

      expect(await handleListEvents({}, ghost, database as never)).toEqual([]);
    });
  });

  describe("the role-specific projection", () => {
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
      expect(projection.event).not.toHaveProperty("status");
      expect(projection.event).not.toHaveProperty("equipment");
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
          },
          {
            id: "el-equipment-other",
            item: "Microphone",
            arrangementStatus: "requested",
            notes: null,
          },
        ])
      );
      expect(projection.event).not.toHaveProperty("expectedAttendance");
      expect(projection.event).not.toHaveProperty("venueRequest");
    });

    it("gives an unregistered attendee the registration terms, with no registration and no internal fields", async () => {
      const [projection] = await handleListEvents(
        { eventId: fixtures.main.id },
        session("attendee"),
        database as never
      );

      expect(projection.access).toBe("attendee");
      expect(projection.event).toMatchObject({
        id: fixtures.main.id,
        name: "Open registration event",
        description: "el-description",
        eventDate: "2026-10-12",
        registrationOpensAt: OPEN_WINDOW.registrationOpensAt,
        registrationClosesAt: OPEN_WINDOW.registrationClosesAt,
        registration: null,
      });
      expect(projection.event).not.toHaveProperty("status");
      expect(projection.event).not.toHaveProperty("expectedAttendance");
      expect(projection.event).not.toHaveProperty("equipment");
      expect(projection.event).not.toHaveProperty("venueRequest");
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

    it("silently omits an event whose registration window has closed for an unregistered attendee", async () => {
      // The row is selected because registration is enabled, but the window check denies it and
      // the projection drops it — so it never reaches this caller.
      const listed = await handleListEvents({}, session("attendee"), database as never);

      expect(listed.map(row => row.event.id)).toContain(fixtures.main.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.closed.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.foreign.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.draft.id);
    });

    it("keeps an under-review event out of an attendee's list and refuses it by id", async () => {
      const listed = await handleListEvents({}, session("attendee"), database as never);

      expect(listed.map(row => row.event.id)).toContain(fixtures.main.id);
      expect(listed.map(row => row.event.id)).not.toContain(fixtures.review.id);
      await expect(
        handleListEvents({ eventId: fixtures.review.id }, session("attendee"), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
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
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });

    it("refuses a named draft even in the caller's own account, like any unavailable event", async () => {
      await expect(
        handleListEvents({ eventId: fixtures.draft.id }, session("organiser"), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
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
