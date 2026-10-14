// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";
import {
  handleAmendVenueBooking,
  handleListVenueBookings,
  handleReleaseVenueBooking,
} from "#/features/venue-requests/bookings.server";
import {
  VENUE_REJECTION_REASON_REQUIRED,
  VENUE_BOOKING_NOT_APPROVED_MESSAGE,
  VENUE_RELEASE_REASON_REQUIRED,
  VENUE_REQUEST_DECIDED_MESSAGE,
  VENUE_REQUEST_DUPLICATE_MESSAGE,
  VENUE_REQUEST_REJECTED_MESSAGE,
  VENUE_REQUEST_SETTLED_MESSAGE,
} from "#/features/venue-requests/schema";
import {
  handleConvertVenueHold,
  handleCreateVenueHold,
} from "#/features/venue-requests/holds.server";
import { loadVenueRequestsForEvent } from "#/features/venue-requests/records.server";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
  handleGetPendingVenueRequestsForEvent,
  handleGetVenueRequestContext,
  handleRejectVenueRequest,
  handleWithdrawVenueRequest,
  venueRequestEventStatusMessage,
  venueRequirementsMessage,
} from "#/features/venue-requests/requests.server";
import { handleGetVenueAvailability, handleSearchVenues } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS, LAYOUT_MESSAGE } from "#/features/venues/schema";
import { notificationSummary, parseNotificationPayload } from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import { eventStatusColumns } from "./event-status";

/** The inbox summary line, which is also the email subject. */
function summarize(row: { kind: string; payload: unknown }): string {
  const parsed = parseNotificationPayload(row.kind, row.payload);
  if (!parsed) throw new Error(`unreadable notification kind: ${row.kind}`);
  return notificationSummary(parsed);
}

/** Render a queued row as an email for content assertions. */
async function renderQueuedEmail(row: { kind: string; payload: unknown; eventRequestId: number }) {
  const parsed = parseNotificationPayload(row.kind, row.payload);
  if (!parsed) throw new Error(`unreadable notification kind: ${row.kind}`);
  return render(renderNotificationEmail({ ...parsed, eventRequestId: row.eventRequestId }).element);
}

/** PTR-31: test request creation, notification, and withdrawal at the handler boundary. PTR-36
 * tests approval and overlap refusal. Middleware provides the session and `venue_request`
 * permission. This file tests event assignment, queued rows and notifications, withdrawal, and the
 * booking invariant.
 */

const users = {
  organiser: {
    id: "venue-request-organiser",
    name: "Venue Request Organiser",
    email: "venue-request-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "venue-request-coordinator",
    name: "Venue Request Coordinator",
    email: "venue-request-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  otherCoordinator: {
    id: "venue-request-other-coordinator",
    name: "Other Venue Request Coordinator",
    email: "venue-request-other-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaffA: {
    id: "venue-request-staff-a",
    name: "Venue Request Staff A",
    email: "venue-request-staff-a@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
  venueStaffB: {
    id: "venue-request-staff-b",
    name: "Venue Request Staff B",
    email: "venue-request-staff-b@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const VENUE_NAME = "PTR-31 Request Hall";
const PTR37_ALTERNATIVE_VENUE_NAME = "PTR-37 Alternative Hall";
/** PTR-138 AC1: the fixture venues meet the fixture event's requirements, so creation accepts them. */
const MEETS_EVENT_REQUIREMENTS = {
  supportedLayouts: ["theatre"],
  accessibilityFeatures: ["Step-free access"],
  facilities: ["Projector", "PA system"],
} satisfies Partial<typeof schema.venues.$inferInsert>;
/** The fixture event's requirements, which a request without session values carries. */
const EVENT_REQUIREMENTS = {
  expectedAttendance: 80,
  layout: "Theatre seating",
  accessibilityRequirements: "Step-free access",
  requiredFacilities: "Projector, PA system",
};
const userIds = Object.values(users).map(user => user.id);
/** What the venue page shows of those requirements: the attendance and layout of each session. */
const EVENT_SESSION_SUMMARY = { expectedAttendance: 80, layout: "Theatre seating" };

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const WINDOW = {
  date: "2027-04-20",
  startTime: "09:00",
  endTime: "12:30",
};

/** PTR-138: a venue request needs the event in `SEARCHABLE_EVENT_STATUSES`. */
const ACCEPTING_STATUSES = [
  "submitted",
  "under_review",
  "awaiting_organiser",
  "approved",
  "planning",
] as const;
const REFUSED_STATUSES = ["draft", "rejected", "confirmed", "completed"] as const;

describe("venue request handlers (PTR-31)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;
  let eventId: number;
  let foreignEventId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  afterAll(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, [users.organiser.id]));
    await database
      .delete(schema.venues)
      .where(inArray(schema.venues.name, [VENUE_NAME, PTR37_ALTERNATIVE_VENUE_NAME]));
    await database.delete(schema.user).where(inArray(schema.user.id, userIds));
    await pool.end();
  });

  beforeEach(async () => {
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, [users.organiser.id]));
    await database
      .delete(schema.venues)
      .where(inArray(schema.venues.name, [VENUE_NAME, PTR37_ALTERNATIVE_VENUE_NAME]));

    const [insertedVenue] = await database
      .insert(schema.venues)
      .values({
        name: VENUE_NAME,
        location: "Request Wing",
        maxCapacity: 200,
        operatingHours: DEFAULT_OPERATING_HOURS,
        ...MEETS_EVENT_REQUIREMENTS,
      })
      .returning({ id: schema.venues.id });
    venueId = insertedVenue.id;

    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-31 Event",
        proposedDates: [{ start: "2027-04-20T09:00", end: "2027-04-20T12:30" }],
        expectedAttendance: 80,
        roomLayoutPreference: "Theatre seating",
        accessibilityRequirements: "Step-free access",
        venueRequirements: "Projector, PA system",
      })
      .returning({ id: schema.eventRequests.id });
    eventId = event.id;

    const [foreignEvent] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.otherCoordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-31 Foreign Event",
      })
      .returning({ id: schema.eventRequests.id });
    foreignEventId = foreignEvent.id;
  });

  /** A second submitted event for the same Coordinator, used to test a clash. */
  async function createEvent(name: string) {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: name,
      })
      .returning({ id: schema.eventRequests.id });
    return event.id;
  }

  function raiseRequest(requestEventId: number, startTime: string, endTime: string) {
    return handleCreateVenueRequest(
      { ...WINDOW, startTime, endTime, eventId: requestEventId, venueId },
      session(users.coordinator),
      database as never
    );
  }

  function approve(id: string, staff: (typeof users)["venueStaffA"]) {
    return handleApproveVenueRequest({ id }, session(staff), database as never);
  }

  async function readRow(id: string) {
    const [row] = await database
      .select()
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, id));
    return row;
  }

  async function createPtr37AlternativeVenue() {
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: PTR37_ALTERNATIVE_VENUE_NAME,
        location: "Request Wing",
        maxCapacity: 200,
        operatingHours: DEFAULT_OPERATING_HOURS,
        ...MEETS_EVENT_REQUIREMENTS,
      })
      .returning({ id: schema.venues.id });
    return venue.id;
  }

  async function loadVenueBookingsForTest(bookingVenueId: number) {
    return database
      .select({
        id: schema.venueRequests.id,
        startsAt: schema.venueRequests.startsAt,
      })
      .from(schema.venueRequests)
      .where(
        and(
          eq(schema.venueRequests.venueId, bookingVenueId),
          eq(schema.venueRequests.status, "approved")
        )
      );
  }

  /** Every notification row queued for one recipient. */
  function readNotifications(recipientId: string) {
    return database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, recipientId));
  }

  function raiseFor(
    requestEventId: number,
    requestVenueId: number,
    startTime: string,
    endTime: string
  ) {
    return handleCreateVenueRequest(
      { date: WINDOW.date, startTime, endTime, eventId: requestEventId, venueId: requestVenueId },
      session(users.coordinator),
      database as never
    );
  }

  async function rowSnapshot(id: string) {
    const row = await readRow(id);
    return {
      status: row.status,
      updatedAt: row.updatedAt.getTime(),
      assignedStaffId: row.assignedStaffId,
    };
  }

  function ledgerFor(ids: string[]) {
    return database
      .select()
      .from(schema.venueOccupancy)
      .where(inArray(schema.venueOccupancy.venueRequestId, ids));
  }

  /** The conflict kind that Venue Staff and the Coordinator read for the event's one request. */
  async function readConflicts() {
    const [staffRead] = await handleGetPendingVenueRequestsForEvent(
      { eventId },
      session(users.venueStaffA),
      database as never
    );
    const [coordinatorCard] = await handleListEvents(
      { eventId },
      session(users.coordinator),
      database as never
    );
    return [staffRead.conflict, coordinatorCard.event.venueRequests?.[0].conflict];
  }

  /** Give the fixture venue the same setup and turnaround time, in minutes. */
  function setBuffers(minutes: number) {
    return database
      .update(schema.venues)
      .set({ setupMinutes: minutes, turnaroundMinutes: minutes })
      .where(eq(schema.venues.id, venueId));
  }

  /** PTR-138 AC1: the alternative venue with what it offers replaced. */
  async function createRoom(offers: Partial<typeof schema.venues.$inferInsert>) {
    const roomId = await createPtr37AlternativeVenue();
    await database.update(schema.venues).set(offers).where(eq(schema.venues.id, roomId));
    return roomId;
  }

  /** PTR-138 AC1: the Coordinator requests `WINDOW` at a room, with any session values. */
  function requestRoom(roomId: number, sessionValues: Record<string, unknown> = {}) {
    return handleCreateVenueRequest(
      { ...WINDOW, eventId, venueId: roomId, ...sessionValues },
      session(users.coordinator),
      database as never
    );
  }

  function eventRows() {
    return database
      .select()
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.eventId, eventId));
  }

  describe("raising a request", () => {
    it("records a pending, unassigned request and notifies every Venue Staff member (AC1, AC3, AC4)", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      expect(request).toMatchObject({
        eventId,
        venueId,
        requestedById: users.coordinator.id,
        startsAt: "2027-04-20 09:00:00",
        endsAt: "2027-04-20 12:30:00",
        status: "pending",
        assignedStaffId: null,
      });
      expect(request.createdAt).toBeInstanceOf(Date);

      const queued = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.eventRequestId, eventId));
      // Notify every Venue Staff account, including this suite's fixtures.
      const allStaff = await database
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.role, "venue_staff"));
      const recipients = queued.map(row => row.recipientId).toSorted();
      expect(recipients).toEqual(allStaff.map(row => row.id).toSorted());
      expect(recipients).toContain(users.venueStaffA.id);
      expect(recipients).toContain(users.venueStaffB.id);
      expect(recipients).not.toContain(users.coordinator.id);
      for (const row of queued) {
        expect(row.kind).toBe("venue_booking_requested");
        expect(row.emailedAt).toBeNull();
        expect(row.payload).toMatchObject({ venueRequestId: request.id, venueName: VENUE_NAME });
        expect(summarize(row)).toBe(`Venue booking requested: ${VENUE_NAME}`);
      }
    });

    it("carries the event's requirements in the notification, and never its name (AC2)", async () => {
      await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      const [row] = await readNotifications(users.venueStaffA.id);
      const html = await renderQueuedEmail(row);

      expect(html).toContain("Theatre seating");
      expect(html).toContain("Step-free access");
      expect(html).toContain("Projector, PA system");
      expect(html).not.toContain("PTR-31 Event");
    });

    it("refuses an event assigned to another Coordinator without creating anything", async () => {
      await expect(
        handleCreateVenueRequest(
          { ...WINDOW, eventId: foreignEventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });

      // Check only this fixture venue because the seed's demo request is also in the table.
      expect(
        await database
          .select()
          .from(schema.venueRequests)
          .where(eq(schema.venueRequests.venueId, venueId))
      ).toHaveLength(0);
      // The refusal rolled back the request and did not queue a notification.
      expect(await database.select().from(schema.notifications)).toHaveLength(0);
    });

    it.each(ACCEPTING_STATUSES)(
      "accepts a request while the event is %s (PTR-138 gate)",
      async status => {
        await database
          .update(schema.eventRequests)
          .set(eventStatusColumns(status, users.coordinator))
          .where(eq(schema.eventRequests.id, eventId));

        const request = await handleCreateVenueRequest(
          { ...WINDOW, eventId, venueId },
          session(users.coordinator),
          database as never
        );

        expect(request.status).toBe("pending");
      }
    );

    // A draft also has no Coordinator. A completed event gets `Forbidden` here, not the
    // completed-event message that approval gives.
    it.each(REFUSED_STATUSES)(
      "refuses a request while the event is %s, and creates nothing (PTR-138 gate)",
      async status => {
        await database
          .update(schema.eventRequests)
          .set(eventStatusColumns(status, users.coordinator))
          .where(eq(schema.eventRequests.id, eventId));

        await expect(
          handleCreateVenueRequest(
            { ...WINDOW, eventId, venueId },
            session(users.coordinator),
            database as never
          )
        ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
        expect(
          await database
            .select()
            .from(schema.venueRequests)
            .where(eq(schema.venueRequests.eventId, eventId))
        ).toEqual([]);
        expect(
          await database
            .select()
            .from(schema.notifications)
            .where(eq(schema.notifications.eventRequestId, eventId))
        ).toEqual([]);
      }
    );

    it("refuses a venue that does not exist", async () => {
      await expect(
        handleCreateVenueRequest(
          { ...WINDOW, eventId, venueId: 987_654 },
          session(users.coordinator),
          database as never
        )
      ).rejects.toMatchObject({ name: "NotFoundError", status: 404, message: "Not Found" });
    });

    it("refuses an exact duplicate of a pending request with the index's message", async () => {
      await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await expect(
        handleCreateVenueRequest(
          { ...WINDOW, eventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_DUPLICATE_MESSAGE,
      });
    });

    it("leaves no extra notification behind when a duplicate request is refused", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );
      const before = await database.select().from(schema.notifications);

      await expect(
        handleCreateVenueRequest(
          { ...WINDOW, eventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).rejects.toThrow(VENUE_REQUEST_DUPLICATE_MESSAGE);

      const rows = await database
        .select({ id: schema.venueRequests.id })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.eventId, eventId));
      expect(rows).toEqual([{ id: request.id }]);
      // The refused duplicate queued nothing. Only the first request's rows remain.
      expect(await database.select().from(schema.notifications)).toHaveLength(before.length);
    });
  });

  describe("session requirements (PTR-138 AC1)", () => {
    it.each([
      ["attendance", { maxCapacity: 40 }, "Holds 40; 80 needed"],
      ["layout", { supportedLayouts: ["boardroom" as const] }, "Does not offer Theatre"],
      ["accessibility", { accessibilityFeatures: [] }, "Missing accessibility: Step-free access"],
      ["facilities", { facilities: ["Projector"] }, "Missing facilities: PA system"],
    ])(
      "refuses a venue that fails the %s requirement, and records and notifies nothing",
      async (_criterion, offers, failure) => {
        const roomId = await createRoom(offers);

        await expect(requestRoom(roomId)).rejects.toMatchObject({
          name: "ConflictError",
          status: 409,
          message: venueRequirementsMessage(PTR37_ALTERNATIVE_VENUE_NAME, [failure]),
        });
        expect(await eventRows()).toEqual([]);
        expect(await readNotifications(users.venueStaffA.id)).toEqual([]);
      }
    );

    it("names every failing requirement in one refusal", async () => {
      const roomId = await createRoom({
        maxCapacity: 40,
        supportedLayouts: ["boardroom"],
        accessibilityFeatures: [],
        facilities: [],
      });

      await expect(requestRoom(roomId)).rejects.toThrow(
        `${PTR37_ALTERNATIVE_VENUE_NAME} does not meet this session's requirements: Holds 40; 80 needed. Does not offer Theatre. Missing accessibility: Step-free access. Missing facilities: Projector, PA system.`
      );
    });

    it("accepts a breakout room that fails the event's attendance but meets the session's", async () => {
      const roomId = await createRoom({ maxCapacity: 40 });

      await expect(requestRoom(roomId)).rejects.toThrow("Holds 40; 80 needed");
      const request = await requestRoom(roomId, { expectedAttendance: 30 });

      // The other session values take the event's requirements.
      expect(request).toMatchObject({
        status: "pending",
        expectedAttendance: 30,
        layout: "Theatre seating",
        accessibilityRequirements: "Step-free access",
        requiredFacilities: "Projector, PA system",
      });
    });

    it("refuses a layout that names no supported layout before any write", async () => {
      await expect(requestRoom(venueId, { layout: "Round tables" })).rejects.toThrow(
        LAYOUT_MESSAGE
      );
      expect(await eventRows()).toEqual([]);
    });

    it("returns the stored session values to Venue Staff, the venue page, and the Coordinator", async () => {
      const roomId = await createRoom({
        maxCapacity: 40,
        supportedLayouts: ["boardroom"],
        accessibilityFeatures: [],
        facilities: ["Whiteboard"],
      });
      // Blank text states no requirement, so the room needs no accessibility feature.
      const request = await requestRoom(roomId, {
        expectedAttendance: 30,
        layout: " Boardroom ",
        accessibilityRequirements: "",
        requiredFacilities: "Whiteboard",
      });
      const stored = {
        expectedAttendance: 30,
        layout: "Boardroom",
        accessibilityRequirements: "",
        requiredFacilities: "Whiteboard",
      };

      expect(await readRow(request.id)).toMatchObject({
        expectedAttendance: 30,
        layout: "Boardroom",
        accessibilityRequirements: "",
        requiredFacilities: "Whiteboard",
      });
      const [notification] = await readNotifications(users.venueStaffA.id);
      expect(notification.payload).toMatchObject({
        expectedAttendance: 30,
        layout: "Boardroom",
        accessibilityRequirements: "",
        requiredFacilities: "Whiteboard",
      });

      const [staffRead] = await handleGetPendingVenueRequestsForEvent(
        { eventId },
        session(users.venueStaffA),
        database as never
      );
      expect(staffRead.requirements).toMatchObject({
        expectedAttendance: 30,
        layout: "Boardroom",
        accessibilityRequirements: "",
        requiredFacilities: "Whiteboard",
      });

      const context = await handleGetVenueRequestContext(
        { eventId, venueId: roomId },
        session(users.coordinator),
        database as never
      );
      expect(context?.requests.map(row => row.requirements)).toEqual([
        { expectedAttendance: 30, layout: "Boardroom" },
      ]);

      const [coordinatorCard] = await handleListEvents(
        { eventId },
        session(users.coordinator),
        database as never
      );
      expect(coordinatorCard.event.venueRequests?.map(entry => entry.requirements)).toEqual([
        stored,
      ]);
      // Only the Coordinator states session requirements, so only their entries carry them.
      const [organiserCard] = await handleListEvents(
        { eventId },
        session(users.organiser),
        database as never
      );
      expect(organiserCard.event.venueRequests?.[0]).not.toHaveProperty("requirements");
    });

    it("gives a row from before session requirements the event's current requirements", async () => {
      const [legacy] = await database
        .insert(schema.venueRequests)
        .values({
          id: "venue-request-legacy",
          eventId,
          venueId,
          requestedById: users.coordinator.id,
          startsAt: "2027-04-20 09:00:00",
          endsAt: "2027-04-20 12:30:00",
        })
        .returning();
      expect(legacy).toMatchObject({
        expectedAttendance: null,
        layout: null,
        accessibilityRequirements: null,
        requiredFacilities: null,
      });
      // The event changed after the request; the fallback reads the current requirements.
      await database
        .update(schema.eventRequests)
        .set({ expectedAttendance: 90 })
        .where(eq(schema.eventRequests.id, eventId));
      const current = { ...EVENT_REQUIREMENTS, expectedAttendance: 90 };

      const [staffRead] = await handleGetPendingVenueRequestsForEvent(
        { eventId },
        session(users.venueStaffA),
        database as never
      );
      expect(staffRead.requirements).toMatchObject({
        expectedAttendance: 90,
        layout: current.layout,
        accessibilityRequirements: current.accessibilityRequirements,
        requiredFacilities: current.requiredFacilities,
      });
      const context = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.coordinator),
        database as never
      );
      expect(context?.requests.map(row => row.requirements)).toEqual([
        { expectedAttendance: 90, layout: current.layout },
      ]);
      const [coordinatorCard] = await handleListEvents(
        { eventId },
        session(users.coordinator),
        database as never
      );
      expect(coordinatorCard.event.venueRequests?.map(entry => entry.requirements)).toEqual([
        current,
      ]);
      // The triage page reads the same entries through the coordination request.
      expect(
        (await loadVenueRequestsForEvent(database as never, eventId)).map(
          entry => entry.requirements
        )
      ).toEqual([current]);
    });

    it("keeps a new request's blank attendance blank after the event states one", async () => {
      // The event states no attendance, so the request stores none and creation checks none.
      await database
        .update(schema.eventRequests)
        .set({ expectedAttendance: null })
        .where(eq(schema.eventRequests.id, eventId));
      const request = await requestRoom(venueId);
      expect(await readRow(request.id)).toMatchObject({
        expectedAttendance: null,
        layout: "Theatre seating",
      });
      // A new attendance on the event was never checked against this venue.
      await database
        .update(schema.eventRequests)
        .set({ expectedAttendance: 500 })
        .where(eq(schema.eventRequests.id, eventId));

      const [staffRead] = await handleGetPendingVenueRequestsForEvent(
        { eventId },
        session(users.venueStaffA),
        database as never
      );
      expect(staffRead.requirements.expectedAttendance).toBeNull();
      const [coordinatorCard] = await handleListEvents(
        { eventId },
        session(users.coordinator),
        database as never
      );
      expect(coordinatorCard.event.venueRequests?.[0].requirements?.expectedAttendance).toBeNull();
    });
  });

  describe("availability (PTR-138 AC1)", () => {
    it("flags a window outside the opening hours, and approval refuses it", async () => {
      // The venue opens at 08:00 on weekdays. Creation accepts the window; hours can change.
      const early = await raiseRequest(eventId, "07:00", "09:00");

      expect(await readConflicts()).toEqual(["unavailable", "unavailable"]);
      await expect(approve(early.id, users.venueStaffA)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: `${VENUE_NAME} cannot host this window: Not open 07:00–09:00 on 2027-04-20.`,
      });
      expect((await readRow(early.id)).status).toBe("pending");
      expect(await ledgerFor([early.id])).toEqual([]);
    });

    it("flags a window that a recorded block overlaps, and approval refuses it", async () => {
      await database.insert(schema.venueUnavailability).values({
        venueId,
        startsAt: "2027-04-20 10:00:00",
        endsAt: "2027-04-20 11:00:00",
        reason: "Floor resurfacing",
      });
      const blocked = await raiseRequest(eventId, "09:30", "10:30");

      expect(await readConflicts()).toEqual(["unavailable", "unavailable"]);
      await expect(approve(blocked.id, users.venueStaffA)).rejects.toThrow(
        `${VENUE_NAME} cannot host this window: Unavailable on 2027-04-20: Floor resurfacing.`
      );

      // Once the block is lifted, the flag clears and approval goes ahead.
      await database
        .delete(schema.venueUnavailability)
        .where(eq(schema.venueUnavailability.venueId, venueId));
      expect(await readConflicts()).toEqual([null, undefined]);
      expect((await approve(blocked.id, users.venueStaffA)).status).toBe("approved");
    });

    it("names a conflicting booking before an unavailable venue, as approval does", async () => {
      const otherEventId = await createEvent("PTR-138 early booking event");
      await approve((await raiseRequest(otherEventId, "08:00", "09:00")).id, users.venueStaffA);
      const early = await raiseRequest(eventId, "07:30", "08:30");

      expect(await readConflicts()).toEqual(["booking", "booking"]);
      await expect(approve(early.id, users.venueStaffA)).rejects.toThrow(
        `${VENUE_NAME} is already booked 20 Apr 2027, 08:00 – 09:00`
      );
    });
  });

  describe("several requests for one event at one venue (PTR-138 AC4)", () => {
    it("records two pending requests at different windows, and approves both in turn", async () => {
      const morning = await raiseRequest(eventId, "09:00", "10:00");
      const afternoon = await raiseRequest(eventId, "13:00", "14:00");

      expect([morning.status, afternoon.status]).toEqual(["pending", "pending"]);

      expect((await approve(morning.id, users.venueStaffA)).status).toBe("approved");
      expect((await approve(afternoon.id, users.venueStaffB)).status).toBe("approved");
      const ledger = (await ledgerFor([morning.id, afternoon.id])).map(row => row.venueRequestId);
      expect(ledger).toHaveLength(2);
      expect(ledger).toEqual(expect.arrayContaining([morning.id, afternoon.id]));
    });

    it("refuses a window that overlaps the event's approved booking", async () => {
      const booked = await raiseRequest(eventId, "09:00", "10:00");
      await approve(booked.id, users.venueStaffA);

      await expect(raiseRequest(eventId, "08:00", "09:30")).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: `This window overlaps this event's approved booking for ${VENUE_NAME} on 20 Apr 2027, 09:00 – 10:00.`,
      });
    });

    it("refuses a back-to-back window when the venue has setup and turnaround time", async () => {
      await database
        .update(schema.venues)
        .set({ setupMinutes: 15, turnaroundMinutes: 30 })
        .where(eq(schema.venues.id, venueId));
      const first = await raiseRequest(eventId, "09:00", "10:00");
      const buffered = `${VENUE_NAME} on 20 Apr 2027, 09:00 – 10:00, including the venue's setup and turnaround time.`;

      await expect(raiseRequest(eventId, "10:00", "11:00")).rejects.toThrow(
        `This window overlaps this event's pending request for ${buffered}`
      );

      // Approval would refuse the same window against the booking, so creation refuses it too.
      await approve(first.id, users.venueStaffA);
      await expect(raiseRequest(eventId, "10:00", "11:00")).rejects.toThrow(
        `This window overlaps this event's approved booking for ${buffered}`
      );

      // 10:00 plus 30 minutes turnaround plus 15 minutes setup: the next session can start 10:45.
      const next = await raiseRequest(eventId, "10:45", "11:45");
      expect((await approve(next.id, users.venueStaffA)).status).toBe("approved");
    });

    it("accepts a back-to-back window when the venue has no setup or turnaround time", async () => {
      const first = await raiseRequest(eventId, "09:00", "10:00");
      const after = await raiseRequest(eventId, "10:00", "11:00");
      const before = await raiseRequest(eventId, "08:00", "09:00");

      expect((await approve(first.id, users.venueStaffA)).status).toBe("approved");
      expect((await approve(after.id, users.venueStaffA)).status).toBe("approved");
      expect((await approve(before.id, users.venueStaffA)).status).toBe("approved");
    });

    it("counts a booking's stored buffers, as approval does, after the venue's buffers change", async () => {
      // The booking stores 30 minutes each side, so it occupies 08:30–10:30.
      await setBuffers(30);
      const booked = await raiseRequest(eventId, "09:00", "10:00");
      await approve(booked.id, users.venueStaffA);
      await setBuffers(0);

      // The venue now has no buffers, but approval still counts the booking's stored ones.
      await expect(raiseRequest(eventId, "10:15", "11:00")).rejects.toThrow(
        `This window overlaps this event's approved booking for ${VENUE_NAME} on 20 Apr 2027, 09:00 – 10:00, including the venue's setup and turnaround time.`
      );
      const next = await raiseRequest(eventId, "10:30", "11:00");
      expect((await approve(next.id, users.venueStaffA)).status).toBe("approved");
    });

    it("accepts a window that only the venue's newer buffers would refuse, as approval does", async () => {
      const booked = await raiseRequest(eventId, "09:00", "10:00");
      await approve(booked.id, users.venueStaffA);
      // The booking stored no buffers. Only the new request's own buffers count now.
      await setBuffers(30);

      const next = await raiseRequest(eventId, "10:30", "11:00");
      expect((await approve(next.id, users.venueStaffA)).status).toBe("approved");
    });

    it("refuses a window that overlaps the event's own hold and points to conversion", async () => {
      const hold = await handleCreateVenueHold(
        { ...WINDOW, startTime: "09:00", endTime: "10:00", eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await expect(raiseRequest(eventId, "09:30", "10:30")).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: `This window overlaps this event's tentative hold for ${VENUE_NAME} on 20 Apr 2027, 09:00 – 10:00. Convert the hold to a booking request instead.`,
      });
      expect(await eventRows()).toEqual([]);

      // Conversion is the way forward, and the hold does not refuse its own conversion.
      const { request } = await handleConvertVenueHold(
        { id: hold.id },
        session(users.coordinator),
        database as never
      );
      expect((await approve(request.id, users.venueStaffA)).status).toBe("approved");
    });

    it("still lets another event's pending request overlap; approval decides (PTR-36)", async () => {
      const otherEventId = await createEvent("PTR-138 AC4 other event");
      await raiseRequest(eventId, "09:00", "10:00");

      const other = await raiseRequest(otherEventId, "09:00", "10:00");

      expect(other.status).toBe("pending");
    });

    it("compares only pending and approved rows of the event", async () => {
      const withdrawn = await raiseRequest(eventId, "09:00", "10:00");
      await handleWithdrawVenueRequest(
        { id: withdrawn.id },
        session(users.coordinator),
        database as never
      );
      const rejected = await raiseRequest(eventId, "11:00", "12:00");
      await handleRejectVenueRequest(
        { id: rejected.id, reason: "Closed for cleaning" },
        session(users.venueStaffA),
        database as never
      );

      expect((await raiseRequest(eventId, "09:00", "10:00")).status).toBe("pending");
      expect((await raiseRequest(eventId, "11:00", "12:00")).status).toBe("pending");
    });

    it("records exactly one of two simultaneous overlapping requests for one event", async () => {
      const results = await Promise.allSettled([
        raiseRequest(eventId, "09:00", "10:00"),
        raiseRequest(eventId, "09:30", "10:30"),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find(result => result.status === "rejected")).toMatchObject({
        reason: { name: "ConflictError", status: 409 },
      });
      const pending = await database
        .select({ id: schema.venueRequests.id })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.eventId, eventId));
      expect(pending).toHaveLength(1);
    });
  });

  describe("Venue Staff visibility (AC3)", () => {
    it("shows a created request to every Venue Staff member, and drops it once withdrawn", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      // The shared pending queue connects both staff members because the row is unassigned.
      const staff = [users.venueStaffA, users.venueStaffB];
      const visible = await Promise.all(
        staff.map(async member => {
          const listed = await handleListEvents({}, session(member), database as never);
          return listed.find(item => item.event.id === eventId);
        })
      );
      expect(visible.map(row => row?.access)).toEqual(["venue_staff", "venue_staff"]);
      expect(visible.map(row => row?.event.venueRequests)).toEqual([
        [
          {
            id: expect.any(String),
            status: "pending",
            venueName: "PTR-31 Request Hall",
            date: "2027-04-20",
            startTime: "09:00",
            endTime: "12:30",
          },
        ],
        [
          {
            id: expect.any(String),
            status: "pending",
            venueName: "PTR-31 Request Hall",
            date: "2027-04-20",
            startTime: "09:00",
            endTime: "12:30",
          },
        ],
      ]);

      await handleWithdrawVenueRequest(
        { id: request.id },
        session(users.coordinator),
        database as never
      );

      const afterWithdrawal = await Promise.all(
        staff.map(member => handleListEvents({}, session(member), database as never))
      );
      expect(
        afterWithdrawal.map(listed => listed.map(item => item.event.id).includes(eventId))
      ).toEqual([false, false]);
    });

    it("keeps a request assigned to another staff member out of the caller's list", async () => {
      await database.insert(schema.venueRequests).values({
        id: "venue-request-assigned-other",
        eventId,
        venueId,
        requestedById: users.coordinator.id,
        assignedStaffId: users.venueStaffB.id,
        startsAt: "2027-04-20 09:00:00",
        endsAt: "2027-04-20 12:30:00",
      });

      // The assignee can reach the event. Another staff member cannot. A direct request by
      // name raises 403 Forbidden. It returns no empty list.
      const assignee = await handleListEvents({}, session(users.venueStaffB), database as never);
      expect(assignee.map(item => item.event.id)).toContain(eventId);

      const listed = await handleListEvents({}, session(users.venueStaffA), database as never);
      expect(listed.map(item => item.event.id)).not.toContain(eventId);

      await expect(
        handleListEvents({ eventId }, session(users.venueStaffA), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });

    it("applies the queue rule to the pending request read", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );
      const pendingIds = async (member: (typeof users)[keyof typeof users]) =>
        (
          await handleGetPendingVenueRequestsForEvent(
            { eventId },
            session(member),
            database as never
          )
        ).map(row => row.id);

      // An unassigned pending row stays readable by every staff member.
      expect(await pendingIds(users.venueStaffA)).toEqual([request.id]);
      expect(await pendingIds(users.venueStaffB)).toEqual([request.id]);

      await database
        .update(schema.venueRequests)
        .set({ assignedStaffId: users.venueStaffB.id })
        .where(eq(schema.venueRequests.id, request.id));

      // A row assigned to another member hides its venue, window, and requirements.
      expect(await pendingIds(users.venueStaffA)).toEqual([]);
      expect(await pendingIds(users.venueStaffB)).toEqual([request.id]);
    });
  });

  describe("the venue page's context read", () => {
    it("answers the caller's event defaults and the event's requests at the venue", async () => {
      const context = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.coordinator),
        database as never
      );

      expect(context).toMatchObject({
        event: {
          id: eventId,
          name: "PTR-31 Event",
          eventDate: "2027-04-20",
          startTime: "09:00",
          endTime: "12:30",
          expectedAttendance: 80,
          layout: "Theatre seating",
          accessibilityRequirements: "Step-free access",
          requiredFacilities: "Projector, PA system",
        },
        canRequest: true,
        requests: [],
      });

      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      const withRequest = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.coordinator),
        database as never
      );
      expect(withRequest?.requests).toEqual([
        {
          id: request.id,
          startsAt: "2027-04-20T09:00",
          endsAt: "2027-04-20T12:30",
          status: "pending",
          requirements: EVENT_SESSION_SUMMARY,
          canWithdraw: true,
        },
      ]);
    });

    it("lists pending and approved rows earliest first, and lets the caller withdraw only their own pending rows (PTR-138 AC4)", async () => {
      const afternoon = await raiseRequest(eventId, "14:00", "15:00");
      const morning = await raiseRequest(eventId, "09:00", "10:00");
      await approve(morning.id, users.venueStaffA);
      const rejected = await raiseRequest(eventId, "16:00", "17:00");
      await handleRejectVenueRequest(
        { id: rejected.id, reason: "Closed for cleaning" },
        session(users.venueStaffA),
        database as never
      );
      const withdrawn = await raiseRequest(eventId, "18:00", "19:00");
      await handleWithdrawVenueRequest(
        { id: withdrawn.id },
        session(users.coordinator),
        database as never
      );
      // Another event's request at the same venue stays out of this event's list.
      await raiseRequest(await createEvent("PTR-138 context neighbour"), "11:00", "12:00");

      // A handover makes the other Coordinator the assignee, who then raises a request too.
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.otherCoordinator.id })
        .where(eq(schema.eventRequests.id, eventId));
      const handedOver = await handleCreateVenueRequest(
        { ...WINDOW, startTime: "12:00", endTime: "13:00", eventId, venueId },
        session(users.otherCoordinator),
        database as never
      );

      const assigneeView = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.otherCoordinator),
        database as never
      );
      expect(assigneeView?.canRequest).toBe(true);
      expect(assigneeView?.requests).toEqual([
        expect.objectContaining({ id: morning.id, status: "approved", canWithdraw: false }),
        expect.objectContaining({ id: handedOver.id, status: "pending", canWithdraw: true }),
        expect.objectContaining({ id: afternoon.id, status: "pending", canWithdraw: false }),
      ]);

      // The raiser is no longer the assignee. They see only the pending rows they raised.
      const raiserView = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.coordinator),
        database as never
      );
      expect(raiserView?.canRequest).toBe(false);
      expect(raiserView?.requests).toEqual([
        {
          id: afternoon.id,
          startsAt: "2027-04-20T14:00",
          endsAt: "2027-04-20T15:00",
          status: "pending",
          requirements: EVENT_SESSION_SUMMARY,
          canWithdraw: true,
        },
      ]);
    });

    it("answers null for an event that is not the caller's, rather than refusing the page", async () => {
      expect(
        await handleGetVenueRequestContext(
          { eventId: foreignEventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).toBeNull();
    });

    it("answers an approved event with no pending request (PTR-138 gate)", async () => {
      const id = await createEvent("PTR-138 approved context event");
      await database
        .update(schema.eventRequests)
        .set({
          status: "approved",
          decidedByCoordinatorId: users.coordinator.id,
          decidedByCoordinatorName: users.coordinator.name,
          decidedAt: new Date(),
        })
        .where(eq(schema.eventRequests.id, id));

      const context = await handleGetVenueRequestContext(
        { eventId: id, venueId },
        session(users.coordinator),
        database as never
      );

      expect(context).toMatchObject({ canRequest: true, requests: [] });
    });

    it("answers null to the assigned Coordinator of a confirmed event with no pending request", async () => {
      await database
        .update(schema.eventRequests)
        .set(eventStatusColumns("confirmed", users.coordinator))
        .where(eq(schema.eventRequests.id, eventId));

      expect(
        await handleGetVenueRequestContext(
          { eventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).toBeNull();
    });
  });

  describe("the context after the event leaves the request gate (AC5)", () => {
    it("still answers the raiser once the event is rejected, and lets them withdraw", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await database
        .update(schema.eventRequests)
        .set(eventStatusColumns("rejected", users.coordinator))
        .where(eq(schema.eventRequests.id, eventId));

      const context = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.coordinator),
        database as never
      );
      expect(context).toMatchObject({
        canRequest: false,
        requests: [{ id: request.id, status: "pending", canWithdraw: true }],
      });

      const withdrawn = await handleWithdrawVenueRequest(
        { id: request.id },
        session(users.coordinator),
        database as never
      );
      expect(withdrawn.status).toBe("withdrawn");
      // With no pending row left and no right to request, the panel has nothing to show.
      expect(
        await handleGetVenueRequestContext(
          { eventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).toBeNull();
    });

    it("answers null for a non-assignee, non-raiser once the event is rejected", async () => {
      await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await database
        .update(schema.eventRequests)
        .set(eventStatusColumns("rejected", users.coordinator))
        .where(eq(schema.eventRequests.id, eventId));

      expect(
        await handleGetVenueRequestContext(
          { eventId, venueId },
          session(users.otherCoordinator),
          database as never
        )
      ).toBeNull();
    });

    it("still answers the raiser after the event is reassigned", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.otherCoordinator.id })
        .where(eq(schema.eventRequests.id, eventId));

      const context = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.coordinator),
        database as never
      );
      expect(context).toMatchObject({
        canRequest: false,
        requests: [{ id: request.id, status: "pending", canWithdraw: true }],
      });

      const withdrawn = await handleWithdrawVenueRequest(
        { id: request.id },
        session(users.coordinator),
        database as never
      );
      expect(withdrawn.status).toBe("withdrawn");
    });
  });

  describe("withdrawing a request", () => {
    it("keeps the row as withdrawn and refuses a second withdrawal (AC5)", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      const withdrawn = await handleWithdrawVenueRequest(
        { id: request.id },
        session(users.coordinator),
        database as never
      );
      expect(withdrawn.status).toBe("withdrawn");

      await expect(
        handleWithdrawVenueRequest(
          { id: request.id },
          session(users.coordinator),
          database as never
        )
      ).rejects.toThrow(VENUE_REQUEST_SETTLED_MESSAGE);
    });

    it("frees the event and venue to be requested again", async () => {
      const first = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );
      await handleWithdrawVenueRequest(
        { id: first.id },
        session(users.coordinator),
        database as never
      );

      const second = await handleCreateVenueRequest(
        { ...WINDOW, endTime: "13:00", eventId, venueId },
        session(users.coordinator),
        database as never
      );

      expect(second.id).not.toBe(first.id);
      const pending = await database
        .select({ id: schema.venueRequests.id })
        .from(schema.venueRequests)
        .where(
          and(
            eq(schema.venueRequests.eventId, eventId),
            eq(schema.venueRequests.venueId, venueId),
            eq(schema.venueRequests.status, "pending")
          )
        );
      expect(pending.map(row => row.id)).toEqual([second.id]);
    });

    it("refuses a Coordinator the request's event is not assigned to", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await expect(
        handleWithdrawVenueRequest(
          { id: request.id },
          session(users.otherCoordinator),
          database as never
        )
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });

    it("refuses a Coordinator the request's event was reassigned to, since they did not raise it (AC5)", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      // The event changes Coordinators after the request. Authorize withdrawal by the requester,
      // not by the event's current owner.
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.otherCoordinator.id })
        .where(eq(schema.eventRequests.id, eventId));

      await expect(
        handleWithdrawVenueRequest(
          { id: request.id },
          session(users.otherCoordinator),
          database as never
        )
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });

      const withdrawn = await handleWithdrawVenueRequest(
        { id: request.id },
        session(users.coordinator),
        database as never
      );
      expect(withdrawn.status).toBe("withdrawn");
    });

    it("refuses an id that does not exist", async () => {
      await expect(
        handleWithdrawVenueRequest(
          { id: "no-such-request" },
          session(users.coordinator),
          database as never
        )
      ).rejects.toMatchObject({ name: "NotFoundError", status: 404, message: "Not Found" });
    });

    it("refuses withdrawal for any caller when the raiser's account is gone", async () => {
      // Account deletion sets `requested_by_id` to null and keeps the row. A null requester must
      // never match a caller's id.
      const [orphan] = await database
        .insert(schema.venueRequests)
        .values({
          id: "venue-request-orphan",
          eventId,
          venueId,
          requestedById: null,
          startsAt: "2027-04-20 09:00:00",
          endsAt: "2027-04-20 12:30:00",
        })
        .returning({ id: schema.venueRequests.id });

      await expect(
        handleWithdrawVenueRequest({ id: orphan.id }, session(users.coordinator), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
      await expect(
        handleWithdrawVenueRequest(
          { id: orphan.id },
          session(users.otherCoordinator),
          database as never
        )
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });
  });

  describe("approving a booking (PTR-36)", () => {
    it("approves a pending request, records who settled it, and holds the venue (AC1, AC2)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      const approved = await approve(request.id, users.venueStaffA);

      expect(approved).toMatchObject({
        status: "approved",
        assignedStaffId: users.venueStaffA.id,
      });

      const availability = await handleGetVenueAvailability(
        { venueId, startDate: WINDOW.date, endDate: WINDOW.date },
        "",
        database as never
      );
      expect(availability?.occupied).toContainEqual(
        expect.objectContaining({
          state: "confirmed",
          label: "another event",
          startsAt: `${WINDOW.date}T09:00:00`,
          endsAt: `${WINDOW.date}T12:30:00`,
        })
      );
    });

    it("refuses an overlapping approval, naming the venue and the conflicting period (AC2)", async () => {
      const first = await raiseRequest(eventId, "09:00", "12:30");
      await approve(first.id, users.venueStaffA);

      const secondEventId = await createEvent("PTR-36 Overlap Event");
      const second = await raiseRequest(secondEventId, "12:00", "14:00");

      await expect(approve(second.id, users.venueStaffB)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: `${VENUE_NAME} is already booked 20 Apr 2027, 09:00 – 12:30`,
      });

      const rows = await database
        .select({ status: schema.venueRequests.status })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, second.id));
      expect(rows).toEqual([{ status: "pending" }]);
    });

    it("allows two approvals that only touch at the boundary (AC3)", async () => {
      const first = await raiseRequest(eventId, "09:00", "12:00");
      await approve(first.id, users.venueStaffA);

      const secondEventId = await createEvent("PTR-36 Handover Event");
      const second = await raiseRequest(secondEventId, "12:00", "14:00");

      expect((await approve(second.id, users.venueStaffB)).status).toBe("approved");
    });

    it("flags a request that only the buffers make conflict, as approval refuses it (PTR-138)", async () => {
      // The other event's booking stores 30 minutes each side, so it occupies 08:30–10:30.
      await setBuffers(30);
      const otherEventId = await createEvent("PTR-138 buffered booking event");
      await approve((await raiseRequest(otherEventId, "09:00", "10:00")).id, users.venueStaffA);
      await setBuffers(0);
      const pending = await raiseRequest(eventId, "10:15", "10:30");

      const [staffRead] = await handleGetPendingVenueRequestsForEvent(
        { eventId },
        session(users.venueStaffA),
        database as never
      );
      expect(staffRead).toMatchObject({ id: pending.id, conflict: "booking" });
      await expect(approve(pending.id, users.venueStaffA)).rejects.toThrow(
        `${VENUE_NAME} is already booked 20 Apr 2027, 08:30 – 10:30`
      );

      // Outside the stored buffers, the flag and approval agree again.
      const clear = await raiseRequest(eventId, "10:30", "11:00");
      const reread = await handleGetPendingVenueRequestsForEvent(
        { eventId },
        session(users.venueStaffA),
        database as never
      );
      expect(reread.find(row => row.id === clear.id)?.conflict).toBeNull();
    });

    it("refuses a request assigned to another staff member", async () => {
      await database.insert(schema.venueRequests).values({
        id: "ptr-36-assigned-other",
        eventId,
        venueId,
        requestedById: users.coordinator.id,
        assignedStaffId: users.venueStaffB.id,
        startsAt: "2027-04-20 09:00:00",
        endsAt: "2027-04-20 12:30:00",
      });

      await expect(approve("ptr-36-assigned-other", users.venueStaffA)).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
    });

    it("refuses a request that is no longer pending", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);

      await expect(approve(request.id, users.venueStaffA)).rejects.toThrow(
        VENUE_REQUEST_DECIDED_MESSAGE
      );
    });

    it.each(["confirmed", "rejected"] as const)(
      "refuses a pending request once its event is %s, and changes nothing",
      async status => {
        const request = await raiseRequest(eventId, "09:00", "12:30");
        await database
          .update(schema.eventRequests)
          .set(eventStatusColumns(status, users.coordinator))
          .where(eq(schema.eventRequests.id, eventId));

        await expect(approve(request.id, users.venueStaffA)).rejects.toMatchObject({
          name: "ConflictError",
          status: 409,
          message: venueRequestEventStatusMessage(status),
        });

        expect(await rowSnapshot(request.id)).toMatchObject({
          status: "pending",
          assignedStaffId: null,
        });
        expect(await ledgerFor([request.id])).toEqual([]);
        expect(await readNotifications(users.coordinator.id)).toEqual([]);
      }
    );

    it("still lets staff reject a stale request on a confirmed event", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await database
        .update(schema.eventRequests)
        .set(eventStatusColumns("confirmed", users.coordinator))
        .where(eq(schema.eventRequests.id, eventId));

      const rejected = await handleRejectVenueRequest(
        { id: request.id, reason: "The event is already confirmed." },
        session(users.venueStaffA),
        database as never
      );

      expect(rejected).toMatchObject({ status: "rejected", assignedStaffId: users.venueStaffA.id });
    });

    it("refuses the second of two simultaneous approvals of one request", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      const results = await Promise.allSettled([
        approve(request.id, users.venueStaffA),
        approve(request.id, users.venueStaffB),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      // The winner settled the row. Return the settled message to the loser, not a self-conflict
      // message or a bare Forbidden response.
      expect(results.find(result => result.status === "rejected")).toMatchObject({
        reason: {
          name: "ConflictError",
          status: 409,
          message: VENUE_REQUEST_DECIDED_MESSAGE,
        },
      });
    });

    it("records exactly one of two simultaneous overlapping approvals (AC5)", async () => {
      const first = await raiseRequest(eventId, "09:00", "12:00");
      const secondEventId = await createEvent("PTR-36 Concurrent Event");
      const second = await raiseRequest(secondEventId, "11:00", "13:00");

      const results = await Promise.allSettled([
        approve(first.id, users.venueStaffA),
        approve(second.id, users.venueStaffB),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find(result => result.status === "rejected")).toMatchObject({
        reason: { name: "ConflictError", status: 409 },
      });

      const approved = await database
        .select({ id: schema.venueRequests.id })
        .from(schema.venueRequests)
        .where(
          and(
            eq(schema.venueRequests.venueId, venueId),
            eq(schema.venueRequests.status, "approved")
          )
        );
      expect(approved).toHaveLength(1);
    });

    it("queues a notification for the Coordinator who raised the request, and only them (PTR-33 AC2)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      await approve(request.id, users.venueStaffA);

      const rows = await readNotifications(users.coordinator.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("venue_booking_approved");
      expect(rows[0].emailedAt).toBeNull();
      expect(rows[0].payload).toMatchObject({
        venueRequestId: request.id,
        eventName: "PTR-31 Event",
        venueName: VENUE_NAME,
      });
      expect(summarize(rows[0])).toBe(`Venue booking approved: ${VENUE_NAME}`);
      const html = await renderQueuedEmail(rows[0]);
      expect(html).toContain("PTR-31 Event");
      expect(html).toContain("09:00–12:30");
      expect(await readNotifications(users.otherCoordinator.id)).toHaveLength(0);
      const staffApproved = (await readNotifications(users.venueStaffA.id)).filter(
        row => row.kind === "venue_booking_approved"
      );
      expect(staffApproved).toHaveLength(0);
    });

    it("commits the approval with its notification queued (PTR-33 AC2)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      const approved = await approve(request.id, users.venueStaffA);

      expect(approved.status).toBe("approved");
      const rows = await readNotifications(users.coordinator.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("venue_booking_approved");
      expect(rows[0].emailedAt).toBeNull();
    });

    it("leaves no notification behind when an approval is refused (PTR-33 AC2)", async () => {
      const first = await raiseRequest(eventId, "09:00", "12:30");
      await approve(first.id, users.venueStaffA);
      const clashEventId = await createEvent("PTR-33 Clash");
      const second = await raiseRequest(clashEventId, "10:00", "11:00");

      await expect(approve(second.id, users.venueStaffB)).rejects.toMatchObject({ status: 409 });

      const queued = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.eventRequestId, clashEventId));
      expect(queued.filter(row => row.kind === "venue_booking_approved")).toHaveLength(0);
    });

    it("stops offering the venue once a booking is approved (PTR-33 AC3)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);

      const search = await handleSearchVenues(
        { date: WINDOW.date, startTime: "09:00", endTime: "12:30" },
        session(users.coordinator),
        database as never
      );

      expect(search.venues.map(venue => venue.id)).not.toContain(venueId);
      expect(search.unsuitable.find(({ venue }) => venue.id === venueId)?.failures).toContainEqual({
        criterion: "booking",
        message: `Booked for another event on ${WINDOW.date}`,
      });
    });
  });

  describe("releasing and amending approved bookings (PTR-37)", () => {
    it("lists the shared upcoming approved bookings with event, venue and period (AC1)", async () => {
      const owned = await raiseRequest(eventId, "09:00", "12:30");
      await approve(owned.id, users.venueStaffA);
      const otherEventId = await createEvent("PTR-37 Other Event");
      const other = await raiseRequest(otherEventId, "13:00", "15:00");
      await approve(other.id, users.venueStaffB);
      const pending = await raiseRequest(
        await createEvent("PTR-37 Pending Event"),
        "16:00",
        "17:00"
      );

      const listed = await handleListVenueBookings(
        database as never,
        new Date("2027-01-01T00:00:00Z")
      );

      // Check only this suite's rows. Other suites and the seed share the global approved-booking list.
      const own = listed.filter(row => row.id === owned.id || row.id === other.id);
      expect(own).toEqual([
        expect.objectContaining({
          id: owned.id,
          eventId,
          eventName: "PTR-31 Event",
          venueName: VENUE_NAME,
          assignedStaffId: users.venueStaffA.id,
          startsAt: "2027-04-20T09:00",
          endsAt: "2027-04-20T12:30",
        }),
        expect.objectContaining({
          id: other.id,
          eventId: otherEventId,
          eventName: "PTR-37 Other Event",
          assignedStaffId: users.venueStaffB.id,
          startsAt: "2027-04-20T13:00",
          endsAt: "2027-04-20T15:00",
        }),
      ]);
      expect(listed.map(row => row.id)).not.toContain(pending.id);
    });

    it("compares upcoming bookings against Singapore venue-local time", async () => {
      const ended = await raiseRequest(eventId, "15:00", "16:00");
      await approve(ended.id, users.venueStaffA);
      const upcoming = await raiseRequest(
        await createEvent("PTR-37 Evening Event"),
        "19:00",
        "20:00"
      );
      await approve(upcoming.id, users.venueStaffB);

      // 10:00 UTC is 18:00 in Singapore. A UTC string comparison would wrongly include 15:00.
      const listed = await handleListVenueBookings(
        database as never,
        new Date("2027-04-20T10:00:00Z")
      );

      expect(listed.map(row => row.id)).toContain(upcoming.id);
      expect(listed.map(row => row.id)).not.toContain(ended.id);
    });

    it("keeps a booking manageable after its approving staff account is deleted", async () => {
      const approver = {
        id: "ptr-37-deleted-approver",
        name: "Deleted Venue Approver",
        email: "ptr-37-deleted-approver@example.invalid",
        role: "venue_staff",
      } as const;
      await database.insert(schema.user).values(approver);
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await handleApproveVenueRequest({ id: request.id }, approver, database as never);
      await database.delete(schema.user).where(eq(schema.user.id, approver.id));

      expect(await handleListVenueBookings(database as never)).toContainEqual(
        expect.objectContaining({ id: request.id, assignedStaffId: null })
      );
      await expect(
        handleReleaseVenueBooking(
          { id: request.id, reason: "Operational handover" },
          session(users.venueStaffA),
          database as never
        )
      ).resolves.toMatchObject({ status: "released" });
    });

    it("releases an owned booking, frees the period and notifies the assigned Coordinator (AC2, AC4, AC5)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);

      const released = await handleReleaseVenueBooking(
        { id: request.id, reason: "  Air-conditioning failure  " },
        session(users.venueStaffA),
        database as never
      );

      expect(released).toMatchObject({
        status: "released",
        releaseReason: "Air-conditioning failure",
        lastChangedByStaffId: users.venueStaffA.id,
        lastChangedByStaffName: users.venueStaffA.name,
      });
      expect(released.lastChangedAt).toBeInstanceOf(Date);
      const [event] = await database
        .select({ status: schema.eventRequests.status })
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, eventId));
      expect(event?.status).toBe("submitted");
      expect((await handleListVenueBookings(database as never)).map(row => row.id)).not.toContain(
        request.id
      );
      const availability = await handleGetVenueAvailability(
        { venueId, startDate: WINDOW.date, endDate: WINDOW.date },
        "",
        database as never
      );
      expect(availability?.occupied ?? []).toEqual([]);
      const queued = (await readNotifications(users.coordinator.id)).filter(
        row => row.kind === "venue_booking_changed"
      );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
      expect(queued[0].payload).toMatchObject({
        venueRequestId: request.id,
        action: "released",
        venueName: VENUE_NAME,
        reason: "Air-conditioning failure",
      });
      expect(summarize(queued[0])).toBe(`Venue booking released: ${VENUE_NAME}`);
      const html = await renderQueuedEmail(queued[0]);
      expect(html).toContain("Air-conditioning failure");
    });

    it("waits on the event before the booking row, so confirmation cannot deadlock", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);

      // Lock the event row as confirmation does, then run the release. Without the event key share,
      // release locks the booking first and waits on the event during notification insert. The
      // different lock orders cause deadlock (40P01).
      const gate = new Pool({ connectionString: process.env.DATABASE_URL });
      const gateClient = await gate.connect();
      try {
        await gateClient.query("BEGIN");
        await gateClient.query("SELECT 1 FROM event_requests WHERE id = $1 FOR UPDATE", [eventId]);
        const { rows: gateRows } = await gateClient.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid"
        );
        const gatePid = gateRows[0].pid;

        const releasing = handleReleaseVenueBooking(
          { id: request.id, reason: "Operational handover" },
          session(users.venueStaffA),
          database as never
        );

        await vi.waitFor(
          async () => {
            // This gate blocks the statement that requests the event key share.
            const waiting = await database.execute<{ count: string }>(
              sql`SELECT count(*)::text AS count FROM pg_stat_activity
                  WHERE wait_event_type = 'Lock'
                    AND query ILIKE '%event_requests%'
                    AND query ILIKE '%for key share%'
                    AND ${gatePid}::int = ANY(pg_blocking_pids(pid))`
            );
            expect(Number(waiting.rows[0].count)).toBeGreaterThanOrEqual(1);
          },
          { timeout: 10_000, interval: 25 }
        );

        // The release waits on the event and has not touched the booking row.
        const probe = await gateClient.query(
          "SELECT 1 FROM venue_requests WHERE id = $1 FOR UPDATE NOWAIT",
          [request.id]
        );
        expect(probe.rowCount).toBe(1);

        await gateClient.query("COMMIT");
        await expect(releasing).resolves.toMatchObject({ status: "released" });
      } finally {
        await gateClient.query("ROLLBACK").catch(() => {});
        gateClient.release();
        await gate.end();
      }
    });

    it("refuses a blank release reason without changing the booking (AC2)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);

      await expect(
        handleReleaseVenueBooking(
          { id: request.id, reason: "   " },
          session(users.venueStaffA),
          database as never
        )
      ).rejects.toThrow(VENUE_RELEASE_REASON_REQUIRED);

      expect(await readRow(request.id)).toMatchObject({ status: "approved", releaseReason: null });
      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, eventId),
            eq(schema.notifications.kind, "venue_booking_changed")
          )
        );
      expect(queued).toHaveLength(0);
    });

    it("retains the actor label after the staff account is deleted", async () => {
      const transientStaff = {
        id: "ptr-37-transient-staff",
        name: "Former Venue Staff",
        email: "ptr-37-transient-staff@example.invalid",
        role: "venue_staff",
      } as const;
      await database.insert(schema.user).values(transientStaff);

      try {
        const request = await raiseRequest(eventId, "09:00", "12:30");
        await handleApproveVenueRequest({ id: request.id }, transientStaff, database as never);
        await handleReleaseVenueBooking(
          { id: request.id, reason: "Emergency maintenance" },
          transientStaff,
          database as never
        );

        await database.delete(schema.user).where(eq(schema.user.id, transientStaff.id));
        expect(await readRow(request.id)).toMatchObject({
          lastChangedByStaffId: null,
          lastChangedByStaffName: transientStaff.name,
        });
      } finally {
        await database.delete(schema.user).where(eq(schema.user.id, transientStaff.id));
      }
    });

    it("notifies the current assignee instead of the original requester", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.otherCoordinator.id })
        .where(eq(schema.eventRequests.id, eventId));

      await handleReleaseVenueBooking(
        { id: request.id, reason: "Emergency maintenance" },
        session(users.venueStaffA),
        database as never
      );

      const queued = await readNotifications(users.otherCoordinator.id);
      expect(queued).toHaveLength(1);
      expect(queued[0].kind).toBe("venue_booking_changed");
      expect(queued[0].emailedAt).toBeNull();
      const raiserChanged = (await readNotifications(users.coordinator.id)).filter(
        row => row.kind === "venue_booking_changed"
      );
      expect(raiserChanged).toHaveLength(0);
    });

    it("falls back to the request raiser when the event has no assigned Coordinator", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: null })
        .where(eq(schema.eventRequests.id, eventId));

      await handleReleaseVenueBooking(
        { id: request.id, reason: "Emergency maintenance" },
        session(users.venueStaffA),
        database as never
      );

      const queued = (await readNotifications(users.coordinator.id)).filter(
        row => row.kind === "venue_booking_changed"
      );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
    });

    it("amends an owned booking and moves the venue hold (AC3, AC4, AC5)", async () => {
      const alternativeVenueId = await createPtr37AlternativeVenue();
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);

      const amended = await handleAmendVenueBooking(
        {
          id: request.id,
          venueId: alternativeVenueId,
          date: WINDOW.date,
          startTime: "12:30",
          endTime: "15:00",
        },
        session(users.venueStaffA),
        database as never
      );

      expect(amended).toMatchObject({
        id: request.id,
        status: "approved",
        venueId: alternativeVenueId,
        startsAt: `${WINDOW.date} 12:30:00`,
        endsAt: `${WINDOW.date} 15:00:00`,
        lastChangedByStaffId: users.venueStaffA.id,
        lastChangedByStaffName: users.venueStaffA.name,
        releaseReason: null,
      });
      expect(amended.lastChangedAt).toBeInstanceOf(Date);
      const queued = (await readNotifications(users.coordinator.id)).filter(
        row => row.kind === "venue_booking_changed"
      );
      expect(queued).toHaveLength(1);
      expect(queued[0].emailedAt).toBeNull();
      expect(queued[0].payload).toMatchObject({
        venueRequestId: request.id,
        action: "amended",
        venueName: PTR37_ALTERNATIVE_VENUE_NAME,
      });
      expect(summarize(queued[0])).toBe(`Venue booking amended: ${PTR37_ALTERNATIVE_VENUE_NAME}`);
      const oldAvailability = await handleGetVenueAvailability(
        { venueId, startDate: WINDOW.date, endDate: WINDOW.date },
        "",
        database as never
      );
      expect(oldAvailability?.occupied ?? []).toEqual([]);
    });

    it("refuses an overlapping amendment and retains the original hold (AC3)", async () => {
      const first = await raiseRequest(eventId, "09:00", "12:00");
      await approve(first.id, users.venueStaffA);
      const second = await raiseRequest(
        await createEvent("PTR-37 Overlap Event"),
        "13:00",
        "15:00"
      );
      await approve(second.id, users.venueStaffB);

      await expect(
        handleAmendVenueBooking(
          {
            id: second.id,
            venueId,
            date: WINDOW.date,
            startTime: "11:00",
            endTime: "14:00",
          },
          session(users.venueStaffB),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: `${VENUE_NAME} is already booked 20 Apr 2027, 09:00 \u2013 12:00`,
      });

      expect(await readRow(second.id)).toMatchObject({
        status: "approved",
        venueId,
        startsAt: `${WINDOW.date} 13:00:00`,
        endsAt: `${WINDOW.date} 15:00:00`,
      });
    });

    it("serializes concurrent amendments to the same target window (AC3)", async () => {
      const alternativeVenueId = await createPtr37AlternativeVenue();
      const first = await raiseRequest(eventId, "09:00", "10:00");
      await approve(first.id, users.venueStaffA);
      const second = await raiseRequest(
        await createEvent("PTR-37 Concurrent Event"),
        "11:00",
        "12:00"
      );
      await database
        .update(schema.venueRequests)
        .set({ venueId: alternativeVenueId })
        .where(eq(schema.venueRequests.id, second.id));
      await approve(second.id, users.venueStaffB);

      const results = await Promise.allSettled([
        handleAmendVenueBooking(
          {
            id: first.id,
            venueId: alternativeVenueId,
            date: WINDOW.date,
            startTime: "14:00",
            endTime: "16:00",
          },
          session(users.venueStaffA),
          database as never
        ),
        handleAmendVenueBooking(
          {
            id: second.id,
            venueId: alternativeVenueId,
            date: WINDOW.date,
            startTime: "14:00",
            endTime: "16:00",
          },
          session(users.venueStaffB),
          database as never
        ),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const rejected = results.find(result => result.status === "rejected");
      expect(rejected).toMatchObject({
        reason: { name: "ConflictError", status: 409 },
      });
      const bookings = await loadVenueBookingsForTest(alternativeVenueId);
      expect(
        bookings.filter(booking => booking.startsAt === `${WINDOW.date} 14:00:00`)
      ).toHaveLength(1);
    });

    it("refuses non-approved mutations and restricts assigned bookings to their approver (AC1, AC5)", async () => {
      const pending = await raiseRequest(eventId, "09:00", "12:30");
      await expect(
        handleReleaseVenueBooking(
          { id: pending.id, reason: "No longer needed" },
          session(users.venueStaffA),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_BOOKING_NOT_APPROVED_MESSAGE,
      });

      await approve(pending.id, users.venueStaffB);
      await expect(
        handleAmendVenueBooking(
          {
            id: pending.id,
            venueId,
            date: WINDOW.date,
            startTime: "13:00",
            endTime: "15:00",
          },
          session(users.venueStaffA),
          database as never
        )
      ).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
      expect(await readRow(pending.id)).toMatchObject({
        status: "approved",
        assignedStaffId: users.venueStaffB.id,
        lastChangedByStaffId: null,
      });
    });

    it("keeps a released booking terminal and the venue period free", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await approve(request.id, users.venueStaffA);
      await handleReleaseVenueBooking(
        { id: request.id, reason: "Emergency maintenance" },
        session(users.venueStaffA),
        database as never
      );

      await expect(approve(request.id, users.venueStaffA)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_DECIDED_MESSAGE,
      });
      await expect(
        handleRejectVenueRequest(
          { id: request.id, reason: "Changed my mind" },
          session(users.venueStaffB),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_DECIDED_MESSAGE,
      });
      await expect(
        handleWithdrawVenueRequest(
          { id: request.id },
          session(users.coordinator),
          database as never
        )
      ).rejects.toMatchObject({ status: 409, message: VENUE_REQUEST_SETTLED_MESSAGE });
      await expect(
        handleReleaseVenueBooking(
          { id: request.id, reason: "Still broken" },
          session(users.venueStaffA),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_BOOKING_NOT_APPROVED_MESSAGE,
      });
      await expect(
        handleAmendVenueBooking(
          {
            id: request.id,
            venueId,
            date: WINDOW.date,
            startTime: "13:00",
            endTime: "15:00",
          },
          session(users.venueStaffA),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_BOOKING_NOT_APPROVED_MESSAGE,
      });

      expect(await readRow(request.id)).toMatchObject({ status: "released" });
      const availability = await handleGetVenueAvailability(
        { venueId, startDate: WINDOW.date, endDate: WINDOW.date },
        "",
        database as never
      );
      expect(availability?.occupied ?? []).toEqual([]);
    });
  });

  describe("rejecting a booking (PTR-34)", () => {
    const ALTERNATIVE_VENUE_NAME = "PTR-34 Alternative Room";
    const REASON = "Closed for floor resurfacing";

    afterEach(async () => {
      await database.delete(schema.venues).where(eq(schema.venues.name, ALTERNATIVE_VENUE_NAME));
    });

    async function createAlternativeVenue() {
      const [alternative] = await database
        .insert(schema.venues)
        .values({
          name: ALTERNATIVE_VENUE_NAME,
          location: "Request Wing",
          maxCapacity: 120,
          operatingHours: DEFAULT_OPERATING_HOURS,
        })
        .returning({ id: schema.venues.id });
      return alternative.id;
    }

    function reject(
      id: string,
      staff: (typeof users)["venueStaffA"],
      extra: Record<string, unknown> = {}
    ) {
      return handleRejectVenueRequest(
        { id, reason: REASON, ...extra },
        session(staff),
        database as never
      );
    }

    it("records the rejection with its reason and who made it, and leaves the pending queue (AC1)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      const rejected = await reject(request.id, users.venueStaffA);

      expect(rejected).toMatchObject({
        status: "rejected",
        rejectionReason: REASON,
        assignedStaffId: users.venueStaffA.id,
        suggestedVenueId: null,
        suggestedDate: null,
        suggestedStartTime: null,
        suggestedEndTime: null,
      });
      const queue = await handleGetPendingVenueRequestsForEvent(
        { eventId },
        session(users.venueStaffA),
        database as never
      );
      expect(queue.map(row => row.id)).not.toContain(request.id);
    });

    it("trims the reason it stores (AC1)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      const rejected = await reject(request.id, users.venueStaffA, { reason: "  Too small  " });

      expect(rejected.rejectionReason).toBe("Too small");
    });

    it("refuses a rejection without a reason and leaves the request pending (AC1)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      await Promise.all(
        [undefined, "", "   "].map(reason =>
          expect(
            handleRejectVenueRequest(
              { id: request.id, reason },
              session(users.venueStaffA),
              database as never
            )
          ).rejects.toThrow(VENUE_REJECTION_REASON_REQUIRED)
        )
      );

      expect(await readRow(request.id)).toMatchObject({ status: "pending", rejectionReason: null });
      const queued = await database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, eventId),
            eq(schema.notifications.kind, "venue_booking_rejected")
          )
        );
      expect(queued).toHaveLength(0);
    });

    it("stores a suggested venue, date and time with the rejection (AC2)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      const alternativeId = await createAlternativeVenue();

      const rejected = await reject(request.id, users.venueStaffA, {
        suggestedVenueId: alternativeId,
        suggestedDate: "2027-04-21",
        suggestedStartTime: "10:00",
        suggestedEndTime: "13:30",
      });

      expect(rejected).toMatchObject({
        suggestedVenueId: alternativeId,
        suggestedDate: "2027-04-21",
        suggestedStartTime: "10:00:00",
        suggestedEndTime: "13:30:00",
      });
    });

    it("accepts any part of a suggestion alone (AC2)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      const rejected = await reject(request.id, users.venueStaffA, { suggestedDate: "2027-04-22" });

      expect(rejected).toMatchObject({
        suggestedVenueId: null,
        suggestedDate: "2027-04-22",
        suggestedStartTime: null,
        suggestedEndTime: null,
      });
    });

    it("refuses a suggested venue that does not exist and leaves the request pending (AC2)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      await expect(
        reject(request.id, users.venueStaffA, { suggestedVenueId: 2147483647 })
      ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });

      expect(await readRow(request.id)).toMatchObject({ status: "pending" });
    });

    it("refuses a request assigned to another staff member (AC1)", async () => {
      await database.insert(schema.venueRequests).values({
        id: "ptr-34-assigned-other",
        eventId,
        venueId,
        requestedById: users.coordinator.id,
        assignedStaffId: users.venueStaffB.id,
        startsAt: "2027-04-20 09:00:00",
        endsAt: "2027-04-20 12:30:00",
      });

      await expect(reject("ptr-34-assigned-other", users.venueStaffA)).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
      });
    });

    it("queues a notification for the Coordinator who raised the request, with the reason and suggestion (AC4)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      const alternativeId = await createAlternativeVenue();

      await reject(request.id, users.venueStaffA, {
        suggestedVenueId: alternativeId,
        suggestedDate: "2027-04-21",
        suggestedStartTime: "10:00",
        suggestedEndTime: "13:30",
      });

      const rows = await readNotifications(users.coordinator.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("venue_booking_rejected");
      expect(rows[0].emailedAt).toBeNull();
      expect(rows[0].payload).toMatchObject({
        venueRequestId: request.id,
        eventName: "PTR-31 Event",
        venueName: VENUE_NAME,
        reason: REASON,
      });
      expect(summarize(rows[0])).toBe(`Venue booking rejected: ${VENUE_NAME}`);
      const html = await renderQueuedEmail(rows[0]);
      expect(html).toContain("PTR-31 Event");
      expect(html).toContain(REASON);
      expect(html).toContain(ALTERNATIVE_VENUE_NAME);
      expect(html).toContain("21 April 2027, 10:00–13:30");
    });

    it("commits the rejection with its notification queued (AC4)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      const rejected = await reject(request.id, users.venueStaffA);

      expect(rejected.status).toBe("rejected");
      const rows = await readNotifications(users.coordinator.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("venue_booking_rejected");
      expect(rows[0].emailedAt).toBeNull();
    });

    it("keeps the rejection when the raiser's account is gone, and queues nothing (AC4)", async () => {
      // Account deletion sets `requested_by_id` to null and keeps the row. No requester remains
      // to notify.
      const [orphan] = await database
        .insert(schema.venueRequests)
        .values({
          id: "ptr-34-orphan-raiser",
          eventId,
          venueId,
          requestedById: null,
          startsAt: "2027-04-20 09:00:00",
          endsAt: "2027-04-20 12:30:00",
        })
        .returning({ id: schema.venueRequests.id });

      const rejected = await reject(orphan.id, users.venueStaffA);

      expect(rejected.status).toBe("rejected");
      expect(
        await database
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.eventRequestId, eventId))
      ).toHaveLength(0);
    });

    it("refuses to approve a rejected request, and the venue stays free (AC5)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await reject(request.id, users.venueStaffA);

      await expect(approve(request.id, users.venueStaffA)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_REJECTED_MESSAGE,
      });
      // Rejection assigns the row to the rejecter. A second staff member must still get the AC5
      // message, not a bare Forbidden response. Check rejected status before queue membership (PTR-34).
      await expect(approve(request.id, users.venueStaffB)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_REJECTED_MESSAGE,
      });

      expect(await readRow(request.id)).toMatchObject({ status: "rejected" });
      const availability = await handleGetVenueAvailability(
        { venueId, startDate: WINDOW.date, endDate: WINDOW.date },
        "",
        database as never
      );
      expect(availability?.occupied ?? []).toEqual([]);
    });

    it("tells any staff member a settled request is settled, not forbidden", async () => {
      // If another staff member approved the request, return the settled message, not Forbidden.
      // The stale form shows this message with no reload to 404.
      const approved = await raiseRequest(eventId, "09:00", "12:30");
      await approve(approved.id, users.venueStaffA);
      await expect(approve(approved.id, users.venueStaffB)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_DECIDED_MESSAGE,
      });
      await expect(reject(approved.id, users.venueStaffB)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_DECIDED_MESSAGE,
      });

      // If the requester withdrew the row, return the same message for either attempt.
      const withdrawn = await raiseRequest(eventId, "13:00", "15:00");
      await handleWithdrawVenueRequest(
        { id: withdrawn.id },
        session(users.coordinator),
        database as never
      );
      await expect(reject(withdrawn.id, users.venueStaffB)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_DECIDED_MESSAGE,
      });
      await expect(approve(withdrawn.id, users.venueStaffA)).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_DECIDED_MESSAGE,
      });
    });

    it("refuses to withdraw or reject a rejected request again (AC5)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await reject(request.id, users.venueStaffA);

      await expect(
        handleWithdrawVenueRequest(
          { id: request.id },
          session(users.coordinator),
          database as never
        )
      ).rejects.toMatchObject({ status: 409, message: VENUE_REQUEST_REJECTED_MESSAGE });
      await expect(
        reject(request.id, users.venueStaffA, { reason: "Changed my mind" })
      ).rejects.toMatchObject({ status: 409, message: VENUE_REQUEST_REJECTED_MESSAGE });
      // Return the same AC5 message when another staff member tries to reject it.
      await expect(
        reject(request.id, users.venueStaffB, { reason: "Changed my mind" })
      ).rejects.toMatchObject({ status: 409, message: VENUE_REQUEST_REJECTED_MESSAGE });

      expect(await readRow(request.id)).toMatchObject({
        status: "rejected",
        rejectionReason: REASON,
      });
    });

    it("frees the event and venue to be requested again after a rejection (AC5)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await reject(request.id, users.venueStaffA);

      const replacement = await raiseRequest(eventId, "13:00", "15:00");

      expect(replacement.status).toBe("pending");
      const queued = await handleGetPendingVenueRequestsForEvent(
        { eventId },
        session(users.venueStaffA),
        database as never
      );
      expect(queued.map(row => row.id)).toEqual([replacement.id]);
    });

    it("does not hold the venue for a rejected request (AC5)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");
      await reject(request.id, users.venueStaffA);

      const search = await handleSearchVenues(
        { date: WINDOW.date, startTime: "09:00", endTime: "12:30" },
        session(users.coordinator),
        database as never
      );
      expect(search.venues.map(venue => venue.id)).toContain(venueId);

      const other = await raiseRequest(await createEvent("PTR-34 Other Event"), "10:00", "11:00");
      expect((await approve(other.id, users.venueStaffB)).status).toBe("approved");
    });

    it("settles a request once when an approval and a rejection race", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      const results = await Promise.allSettled([
        approve(request.id, users.venueStaffA),
        reject(request.id, users.venueStaffB),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const row = await readRow(request.id);
      expect(row.status === "approved" ? row.rejectionReason : row.status).toBe(
        row.status === "approved" ? null : "rejected"
      );
    });

    it("refuses a rejected row without a reason at the database (AC1)", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      // This test covers a reason with only tabs and newlines. `btrim` removes spaces only, so the
      // CHECK must require a non-whitespace character.
      await Promise.all(
        [null, "   ", "\t\n"].map(rejectionReason =>
          expect(
            database
              .update(schema.venueRequests)
              .set({ status: "rejected", rejectionReason })
              .where(eq(schema.venueRequests.id, request.id))
          ).rejects.toMatchObject({
            cause: { code: "23514", constraint: "venue_requests_rejection_has_reason" },
          })
        )
      );

      await database
        .update(schema.venueRequests)
        .set({ status: "rejected", rejectionReason: REASON })
        .where(eq(schema.venueRequests.id, request.id));
      expect((await readRow(request.id)).status).toBe("rejected");
    });
  });

  describe("several venues for one event (PTR-138)", () => {
    it("AC1 (PTR-138): records a request per venue and checks each venue independently", async () => {
      // A breakout room for 40 cannot hold the event's 80, but it can hold a 30-person session.
      const roomId = await createRoom({ maxCapacity: 40 });

      // Suitability: each venue is checked against its own request's requirements.
      await expect(raiseFor(eventId, roomId, "11:00", "12:00")).rejects.toThrow(
        venueRequirementsMessage(PTR37_ALTERNATIVE_VENUE_NAME, ["Holds 40; 80 needed"])
      );
      const hall = await raiseFor(eventId, venueId, "09:00", "10:00");
      const breakout = await requestRoom(roomId, {
        startTime: "11:00",
        endTime: "12:00",
        expectedAttendance: 30,
      });
      const rows = await database
        .select({ id: schema.venueRequests.id, venueId: schema.venueRequests.venueId })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.eventId, eventId));
      expect(rows.toSorted((left, right) => left.venueId - right.venueId)).toEqual(
        [
          { id: hall.id, venueId },
          { id: breakout.id, venueId: roomId },
        ].toSorted((left, right) => left.venueId - right.venueId)
      );

      // Availability and conflicts: another event's approved booking overlaps the hall request
      // only. The breakout request at the other venue stays clear.
      const neighbour = await createEvent("PTR-138 AC1 neighbour");
      const booking = await raiseFor(neighbour, venueId, "09:30", "10:30");
      await approve(booking.id, users.venueStaffA);

      const [card] = await handleListEvents(
        { eventId },
        session(users.coordinator),
        database as never
      );
      expect(
        card.event.venueRequests?.map(entry => ({ id: entry.id, conflict: entry.conflict }))
      ).toEqual([
        { id: hall.id, conflict: "booking" },
        { id: breakout.id, conflict: undefined },
      ]);
      const staffRead = await handleGetPendingVenueRequestsForEvent(
        { eventId },
        session(users.venueStaffA),
        database as never
      );
      expect(staffRead.map(row => ({ id: row.id, conflict: row.conflict }))).toEqual([
        { id: hall.id, conflict: "booking" },
        { id: breakout.id, conflict: null },
      ]);
    });

    it("AC2 (PTR-138): deciding one pending request leaves the sibling unchanged; the projection lists both states", async () => {
      const altVenueId = await createPtr37AlternativeVenue();
      const requestA = await raiseFor(eventId, venueId, "09:00", "10:00");
      const requestB = await raiseFor(eventId, altVenueId, "11:00", "12:00");
      const beforeB = await rowSnapshot(requestB.id);

      await approve(requestA.id, users.venueStaffA);
      expect(await rowSnapshot(requestB.id)).toEqual(beforeB);
      const decidedA = await rowSnapshot(requestA.id);

      await handleRejectVenueRequest(
        { id: requestB.id, reason: "Closed for floor resurfacing" },
        session(users.venueStaffB),
        database as never
      );
      expect(await rowSnapshot(requestA.id)).toEqual(decidedA);
      expect((await readRow(requestB.id)).status).toBe("rejected");

      const [projection] = await handleListEvents(
        { eventId },
        session(users.coordinator),
        database as never
      );
      expect(projection.event.venueRequests).toMatchObject([
        {
          id: requestA.id,
          status: "approved",
          venueName: VENUE_NAME,
          date: WINDOW.date,
          startTime: "09:00",
          endTime: "10:00",
        },
        {
          id: requestB.id,
          status: "rejected",
          venueName: PTR37_ALTERNATIVE_VENUE_NAME,
          date: WINDOW.date,
          startTime: "11:00",
          endTime: "12:00",
          rejection: { reason: "Closed for floor resurfacing" },
        },
      ]);
      // Only the rejected row offers an adjustment. No later request exists at its venue.
      expect(
        (projection.event.venueRequests ?? []).map(entry => entry.adjustable ?? false)
      ).toEqual([false, true]);
    });

    it("AC3 (PTR-138): releasing one approved booking keeps the sibling; amending onto the sibling's period is refused", async () => {
      const altVenueId = await createPtr37AlternativeVenue();
      const requestA = await raiseFor(eventId, venueId, "09:00", "10:00");
      const requestB = await raiseFor(eventId, altVenueId, "11:00", "12:00");
      await approve(requestA.id, users.venueStaffA);
      await approve(requestB.id, users.venueStaffA);

      expect(
        (await ledgerFor([requestA.id, requestB.id]))
          .map(row => row.venueRequestId)
          .toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))
      ).toEqual([requestA.id, requestB.id].toSorted((a, b) => a.localeCompare(b)));

      // Amending B onto A's approved period names the conflict and changes nothing.
      await expect(
        handleAmendVenueBooking(
          {
            id: requestB.id,
            venueId,
            date: WINDOW.date,
            startTime: "09:00",
            endTime: "10:00",
          },
          session(users.venueStaffA),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: `${VENUE_NAME} is already booked 20 Apr 2027, 09:00 \u2013 10:00`,
      });
      expect(await readRow(requestB.id)).toMatchObject({
        status: "approved",
        venueId: altVenueId,
        startsAt: `${WINDOW.date} 11:00:00`,
        endsAt: `${WINDOW.date} 12:00:00`,
      });
      expect(await readRow(requestA.id)).toMatchObject({ status: "approved" });

      // Releasing A keeps B's row approved and B's ledger row intact.
      await handleReleaseVenueBooking(
        { id: requestA.id, reason: "Air-conditioning failure" },
        session(users.venueStaffA),
        database as never
      );
      expect(await readRow(requestB.id)).toMatchObject({ status: "approved" });
      expect(await ledgerFor([requestA.id, requestB.id])).toEqual([
        expect.objectContaining({ venueRequestId: requestB.id }),
      ]);
    });

    it("AC3 (PTR-138): amending one approved booking moves its ledger row; the sibling's row and ledger row stay unchanged", async () => {
      const altVenueId = await createPtr37AlternativeVenue();
      const requestA = await raiseFor(eventId, venueId, "09:00", "10:00");
      const requestB = await raiseFor(eventId, altVenueId, "11:00", "12:00");
      await approve(requestA.id, users.venueStaffA);
      await approve(requestB.id, users.venueStaffB);
      const [ledgerA] = await ledgerFor([requestA.id]);
      expect(ledgerA).toMatchObject({
        venueId,
        startsAt: `${WINDOW.date} 09:00:00`,
        endsAt: `${WINDOW.date} 10:00:00`,
      });
      // The full row covers the status, the window and the staff fields.
      const siblingBefore = await readRow(requestB.id);
      const siblingLedgerBefore = await ledgerFor([requestB.id]);
      expect(siblingLedgerBefore).toEqual([
        expect.objectContaining({
          venueId: altVenueId,
          eventId,
          startsAt: `${WINDOW.date} 11:00:00`,
          endsAt: `${WINDOW.date} 12:00:00`,
          active: true,
        }),
      ]);

      // A moves to the sibling's venue, in a window clear of the sibling's booking.
      const amended = await handleAmendVenueBooking(
        {
          id: requestA.id,
          venueId: altVenueId,
          date: WINDOW.date,
          startTime: "14:00",
          endTime: "15:30",
        },
        session(users.venueStaffA),
        database as never
      );

      expect(amended).toMatchObject({
        status: "approved",
        venueId: altVenueId,
        startsAt: `${WINDOW.date} 14:00:00`,
        endsAt: `${WINDOW.date} 15:30:00`,
        lastChangedByStaffId: users.venueStaffA.id,
      });
      const ledgerAAfter = await ledgerFor([requestA.id]);
      expect(ledgerAAfter).toEqual([
        expect.objectContaining({
          venueId: altVenueId,
          eventId,
          startsAt: `${WINDOW.date} 14:00:00`,
          endsAt: `${WINDOW.date} 15:30:00`,
          active: true,
        }),
      ]);
      expect(ledgerAAfter[0].id).not.toBe(ledgerA.id);
      expect(await readRow(requestB.id)).toEqual(siblingBefore);
      expect(await ledgerFor([requestB.id])).toEqual(siblingLedgerBefore);
    });

    it("AC4 (PTR-138): the same venue hosts separate sessions; duplicates and overlaps are still refused", async () => {
      const first = await raiseFor(eventId, venueId, "09:00", "10:00");
      await approve(first.id, users.venueStaffA);

      // The same venue at a non-overlapping window: created and approved beside the first booking.
      const second = await raiseFor(eventId, venueId, "11:00", "12:00");
      expect(second.status).toBe("pending");
      await expect(raiseFor(eventId, venueId, "11:00", "12:00")).rejects.toThrow(
        VENUE_REQUEST_DUPLICATE_MESSAGE
      );
      await expect(raiseFor(eventId, venueId, "11:30", "12:30")).rejects.toThrow(
        `This window overlaps this event's pending request for ${VENUE_NAME} on 20 Apr 2027, 11:00 – 12:00.`
      );
      await approve(second.id, users.venueStaffA);
      expect(
        (await ledgerFor([first.id, second.id]))
          .map(row => row.venueRequestId)
          .toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))
      ).toEqual([first.id, second.id].toSorted((a, b) => a.localeCompare(b)));
    });

    it("AC5 (PTR-138): lists venue, period and state on each row; the Coordinator sees every row, the Organiser only pending and approved rows, and each Venue Staff member only the shared queue and their own decisions", async () => {
      const altVenueId = await createPtr37AlternativeVenue();
      const pending = await raiseFor(eventId, venueId, "09:00", "10:00");
      const approved = await raiseFor(eventId, altVenueId, "11:00", "12:00");
      await approve(approved.id, users.venueStaffA);
      const rejected = await raiseFor(eventId, altVenueId, "13:00", "14:00");
      await handleRejectVenueRequest(
        { id: rejected.id, reason: "Closed for floor resurfacing" },
        session(users.venueStaffB),
        database as never
      );
      const pendingEntry = {
        id: pending.id,
        status: "pending",
        venueName: VENUE_NAME,
        date: WINDOW.date,
        startTime: "09:00",
        endTime: "10:00",
      };
      const approvedEntry = {
        id: approved.id,
        status: "approved",
        venueName: PTR37_ALTERNATIVE_VENUE_NAME,
        date: WINDOW.date,
        startTime: "11:00",
        endTime: "12:00",
      };
      const rejectedPeriod = { date: WINDOW.date, startTime: "13:00", endTime: "14:00" };
      const rejectedEntry = {
        id: rejected.id,
        status: "rejected",
        venueName: PTR37_ALTERNATIVE_VENUE_NAME,
        ...rejectedPeriod,
        rejection: {
          venueId: altVenueId,
          reason: "Closed for floor resurfacing",
          suggestion: null,
          suggestedVenueId: null,
        },
      };

      // Every list arrives earliest window first. Only the Coordinator's copy marks the rejection
      // adjustable and carries each row's session requirements (PTR-138 AC1).
      const [coordinatorView] = await handleListEvents(
        { eventId },
        session(users.coordinator),
        database as never
      );
      const requirements = EVENT_REQUIREMENTS;
      expect(coordinatorView.event.venueRequests).toEqual([
        { ...pendingEntry, requirements },
        { ...approvedEntry, requirements },
        { ...rejectedEntry, requirements, adjustable: true },
      ]);

      // The Organiser gets no rejected row, so no rejection reason reaches them.
      const [organiserView] = await handleListEvents(
        { eventId },
        session(users.organiser),
        database as never
      );
      expect(organiserView.event.venueRequests).toEqual([pendingEntry, approvedEntry]);

      // Each Venue Staff member gets the shared pending queue plus the rows they decided: A gets
      // the booking they approved, and B gets the request they rejected, with its reason.
      const staffView = async (member: (typeof users)["venueStaffA"]) =>
        (await handleListEvents({}, session(member), database as never)).find(
          item => item.event.id === eventId
        )?.event.venueRequests;
      expect(await staffView(users.venueStaffA)).toEqual([pendingEntry, approvedEntry]);
      expect(await staffView(users.venueStaffB)).toEqual([pendingEntry, rejectedEntry]);
    });
  });
});
