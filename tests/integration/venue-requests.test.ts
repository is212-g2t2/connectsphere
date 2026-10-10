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
  handleApproveVenueRequest,
  handleCreateVenueRequest,
  handleGetPendingVenueRequest,
  handleGetVenueRequestContext,
  handleRejectVenueRequest,
  handleWithdrawVenueRequest,
} from "#/features/venue-requests/requests.server";
import { handleGetVenueAvailability, handleSearchVenues } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import { notificationSummary, parseNotificationPayload } from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";

/** The inbox summary line for a queued row, which doubles as the email subject. */
function summarize(row: { kind: string; payload: unknown }): string {
  const parsed = parseNotificationPayload(row.kind, row.payload);
  if (!parsed) throw new Error(`unreadable notification kind: ${row.kind}`);
  return notificationSummary(parsed);
}

/** Renders a queued row as its email, so content assertions keep working. */
async function renderQueuedEmail(row: { kind: string; payload: unknown; eventRequestId: number }) {
  const parsed = parseNotificationPayload(row.kind, row.payload);
  if (!parsed) throw new Error(`unreadable notification kind: ${row.kind}`);
  return render(renderNotificationEmail({ ...parsed, eventRequestId: row.eventRequestId }).element);
}

/**
 * PTR-31 at the handler boundary: creation, notification and withdrawal. PTR-36 adds approval,
 * the overlap refusal and the exclusion constraint's own behaviour. The middleware pipeline has
 * already established the session and the `venue_request` permission before these run, so the
 * caller is a `SessionUser` and the only things under test are the event-assignment gate, the row
 * that lands in the queue, the queued notifications, the withdrawal transition and the booking invariant.
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
const userIds = Object.values(users).map(user => user.id);

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const WINDOW = {
  date: "2027-04-20",
  startTime: "09:00",
  endTime: "12:30",
};

describe("venue request handlers (PTR-31)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;
  let eventId: number;
  let foreignEventId: number;
  let underReviewEventId: number;

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

    const [underReviewEvent] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "under_review",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        eventName: "PTR-31 Under Review Event",
      })
      .returning({ id: schema.eventRequests.id });
    underReviewEventId = underReviewEvent.id;
  });

  /** A second submitted event assigned to the same Coordinator, for the other side of a clash. */
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

  function insertRequest(values: {
    id: string;
    eventId: number;
    venueId?: number;
    startsAt: string;
    endsAt: string;
    status: "pending" | "withdrawn" | "approved" | "released";
  }) {
    return database.insert(schema.venueRequests).values({
      requestedById: users.coordinator.id,
      venueId,
      ...values,
    });
  }

  async function createPtr37AlternativeVenue() {
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: PTR37_ALTERNATIVE_VENUE_NAME,
        location: "Request Wing",
        maxCapacity: 200,
        operatingHours: DEFAULT_OPERATING_HOURS,
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
      // Every Venue Staff account in the database is told, this suite's fixtures included.
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

      // Scoped to the fixture venue: the seed's own demo request is always in the table.
      expect(
        await database
          .select()
          .from(schema.venueRequests)
          .where(eq(schema.venueRequests.venueId, venueId))
      ).toHaveLength(0);
      // The refusal rolled everything back: no notification was queued either.
      expect(await database.select().from(schema.notifications)).toHaveLength(0);
    });

    it("refuses an event that is no longer awaiting a booking decision", async () => {
      await expect(
        handleCreateVenueRequest(
          { ...WINDOW, eventId: underReviewEventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });

    it("refuses a venue that does not exist", async () => {
      await expect(
        handleCreateVenueRequest(
          { ...WINDOW, eventId, venueId: 987_654 },
          session(users.coordinator),
          database as never
        )
      ).rejects.toMatchObject({ name: "NotFoundError", status: 404, message: "Not Found" });
    });

    it("refuses a second pending request for the same event and venue", async () => {
      await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await expect(
        handleCreateVenueRequest(
          { ...WINDOW, endTime: "13:00", eventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).rejects.toThrow(VENUE_REQUEST_DUPLICATE_MESSAGE);
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
          { ...WINDOW, endTime: "13:00", eventId, venueId },
          session(users.coordinator),
          database as never
        )
      ).rejects.toThrow(VENUE_REQUEST_DUPLICATE_MESSAGE);

      const rows = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, request.id));
      expect(rows).toHaveLength(1);
      // The refused duplicate queued nothing: only the first request's rows remain.
      expect(await database.select().from(schema.notifications)).toHaveLength(before.length);
    });
  });

  describe("Venue Staff visibility (AC3)", () => {
    it("shows a created request to every Venue Staff member, and drops it once withdrawn", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      // The row is unassigned: the shared pending queue is what connects both staff members.
      const staff = [users.venueStaffA, users.venueStaffB];
      const visible = await Promise.all(
        staff.map(async member => {
          const listed = await handleListEvents({}, session(member), database as never);
          return listed.find(item => item.event.id === eventId);
        })
      );
      expect(visible.map(row => row?.access)).toEqual(["venue_staff", "venue_staff"]);
      expect(visible.map(row => row?.event.venueRequest)).toEqual([
        { id: expect.any(String), status: "pending", venueName: "PTR-31 Request Hall" },
        { id: expect.any(String), status: "pending", venueName: "PTR-31 Request Hall" },
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

      // The assignee reaches the event; the isolation is that the other staff member does not,
      // and asking for it by name is refused rather than answered with nothing.
      const assignee = await handleListEvents({}, session(users.venueStaffB), database as never);
      expect(assignee.map(item => item.event.id)).toContain(eventId);

      const listed = await handleListEvents({}, session(users.venueStaffA), database as never);
      expect(listed.map(item => item.event.id)).not.toContain(eventId);

      await expect(
        handleListEvents({ eventId }, session(users.venueStaffA), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });
  });

  describe("the venue page's context read", () => {
    it("answers the caller's event defaults and the pending request", async () => {
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
        request: null,
      });

      await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      const withRequest = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.coordinator),
        database as never
      );
      expect(withRequest?.request).toMatchObject({
        startsAt: "2027-04-20T09:00",
        endsAt: "2027-04-20T12:30",
        canWithdraw: true,
      });
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
  });

  describe("the context after the event leaves `submitted` (AC5)", () => {
    it("still answers the raiser under review, and lets them withdraw", async () => {
      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await database
        .update(schema.eventRequests)
        .set({ status: "under_review" })
        .where(eq(schema.eventRequests.id, eventId));

      const context = await handleGetVenueRequestContext(
        { eventId, venueId },
        session(users.coordinator),
        database as never
      );
      expect(context?.request).toMatchObject({ id: request.id, canWithdraw: true });

      const withdrawn = await handleWithdrawVenueRequest(
        { id: request.id },
        session(users.coordinator),
        database as never
      );
      expect(withdrawn.status).toBe("withdrawn");
    });

    it("answers null for a non-assignee, non-raiser once the event is under review", async () => {
      await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      await database
        .update(schema.eventRequests)
        .set({ status: "under_review" })
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
      expect(context?.request).toMatchObject({ id: request.id, canWithdraw: true });

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

      // The event moves to another Coordinator after the request was raised. Withdrawal authorizes
      // on who raised the request, not who now owns the event.
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
      // `requested_by_id` is `set null` on account deletion, not cascade: the row survives
      // unattributable, and null must never match a caller's id.
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

    it("refuses the second of two simultaneous approvals of one request", async () => {
      const request = await raiseRequest(eventId, "09:00", "12:30");

      const results = await Promise.allSettled([
        approve(request.id, users.venueStaffA),
        approve(request.id, users.venueStaffB),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      // The settled row now belongs to the winner, so the loser sees the settled sentence — never a
      // self-conflict sentence about the request it just approved, and never a bare Forbidden.
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

      // Scoped to this suite's own rows: other suites' and the seed's approved bookings share the
      // global list.
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

      // 10:00 UTC is 18:00 in Singapore. A UTC string comparison would incorrectly retain 15:00.
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

      // Hold the event row the way confirmation does, then let the release run into it. Without
      // the event key share, the release takes the booking row first and waits on the event
      // through its notification insert: the two orders form a deadlock (40P01).
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
            // The blocked statement names the event key share, and this gate is its blocker.
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

        // Parked on the event, the release has not touched the booking row yet.
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

  describe("the overlap constraint itself (PTR-36 AC1, AC3)", () => {
    it("refuses a second overlapping approved booking at the database", async () => {
      await insertRequest({
        id: "ptr-36-direct-1",
        eventId,
        startsAt: "2027-04-20 09:00:00",
        endsAt: "2027-04-20 12:00:00",
        status: "approved",
      });

      // Drizzle wraps the driver error, so the constraint name is on the cause, not the message.
      await expect(
        insertRequest({
          id: "ptr-36-direct-2",
          eventId: foreignEventId,
          startsAt: "2027-04-20 11:00:00",
          endsAt: "2027-04-20 13:00:00",
          status: "approved",
        })
      ).rejects.toMatchObject({
        cause: { code: "23P01", constraint: "venue_requests_no_overlap" },
      });
    });

    it("allows a boundary touch, another venue, and overlapping non-approved rows", async () => {
      await insertRequest({
        id: "ptr-36-direct-3",
        eventId,
        startsAt: "2027-04-20 09:00:00",
        endsAt: "2027-04-20 12:00:00",
        status: "approved",
      });
      await insertRequest({
        id: "ptr-36-direct-4",
        eventId: foreignEventId,
        startsAt: "2027-04-20 12:00:00",
        endsAt: "2027-04-20 14:00:00",
        status: "approved",
      });

      const [otherVenue] = await database
        .insert(schema.venues)
        .values({
          name: "PTR-36 Spillover Hall",
          location: "Overflow Wing",
          maxCapacity: 50,
          operatingHours: DEFAULT_OPERATING_HOURS,
        })
        .returning({ id: schema.venues.id });
      await insertRequest({
        id: "ptr-36-direct-5",
        eventId,
        venueId: otherVenue.id,
        startsAt: "2027-04-20 09:00:00",
        endsAt: "2027-04-20 12:00:00",
        status: "approved",
      });
      await database
        .delete(schema.venueRequests)
        .where(eq(schema.venueRequests.id, "ptr-36-direct-5"));
      await database.delete(schema.venues).where(eq(schema.venues.id, otherVenue.id));

      // The predicate covers approved rows only: pending requests stack, and a withdrawn row
      // never holds the venue.
      await insertRequest({
        id: "ptr-36-direct-6",
        eventId,
        startsAt: "2027-04-20 10:00:00",
        endsAt: "2027-04-20 11:00:00",
        status: "pending",
      });
      await insertRequest({
        id: "ptr-36-direct-7",
        eventId: foreignEventId,
        startsAt: "2027-04-20 10:30:00",
        endsAt: "2027-04-20 11:30:00",
        status: "pending",
      });
      await insertRequest({
        id: "ptr-36-direct-8",
        eventId,
        startsAt: "2027-04-20 09:00:00",
        endsAt: "2027-04-20 12:00:00",
        status: "withdrawn",
      });

      const rows = await database
        .select({ id: schema.venueRequests.id })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.venueId, venueId));
      expect(rows.map(row => row.id).toSorted()).toEqual(
        [
          "ptr-36-direct-3",
          "ptr-36-direct-4",
          "ptr-36-direct-6",
          "ptr-36-direct-7",
          "ptr-36-direct-8",
        ].toSorted()
      );
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
      const queue = await handleGetPendingVenueRequest({ id: request.id }, database as never);
      expect(queue).toBeNull();
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
      // `requested_by_id` is `set null` on account deletion, not cascade: the row survives
      // unattributable, and there is no recipient left to queue for.
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
      // Rejection stamps `assignedStaffId` to the rejecter, so a second staff member who never
      // touched this request must still see the AC5 sentence rather than a bare Forbidden — the
      // rejected check runs before the queue rule for exactly this reason (review of PTR-34).
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
      // Approved by one staff member: another staff member's attempt gets the settled sentence
      // rather than a bare Forbidden, so a stale form can toast it instead of reloading into 404.
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

      // Withdrawn by the raiser: the same sentence for either attempt on the stale row.
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
      // Same AC5 sentence for a second staff member trying to reject it again.
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
      const queued = await handleGetPendingVenueRequest({ id: replacement.id }, database as never);
      expect(queued?.id).toBe(replacement.id);
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

      // A tab/newline-only reason is the review's gap: `btrim` alone strips plain spaces, not
      // every whitespace character, so the CHECK now matches on any non-space character instead.
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
});
