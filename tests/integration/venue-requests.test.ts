// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";
import {
  VENUE_REQUEST_DUPLICATE_MESSAGE,
  VENUE_REQUEST_SETTLED_MESSAGE,
} from "#/features/venue-requests/schema";
import {
  handleCreateVenueRequest,
  handleGetVenueRequestContext,
  handleWithdrawVenueRequest,
} from "#/features/venue-requests/requests.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/**
 * PTR-31 at the handler boundary: creation, notification and withdrawal. The middleware pipeline
 * has already established the session and `venue_request:request` before these run, so the caller
 * is a `SessionUser` and the only things under test are the event-assignment gate, the row that
 * lands in the queue, the emails, and the withdrawal transition.
 */

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi
    .fn<(to: string, subject: string, react: ReactElement) => Promise<unknown>>()
    .mockResolvedValue({ id: "test-email" }),
}));

vi.mock("#/lib/mailer.server", () => ({
  createMailer: vi.fn<() => null>(() => null),
  getMailer: vi.fn<() => null>(() => null),
  sendEmail,
}));

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
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
    await database.delete(schema.user).where(inArray(schema.user.id, userIds));
    await pool.end();
  });

  beforeEach(async () => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ id: "test-email" });

    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, [users.organiser.id]));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));

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

      const recipients = sendEmail.mock.calls.map(call => call[0]);
      expect(recipients).toContain(users.venueStaffA.email);
      expect(recipients).toContain(users.venueStaffB.email);
      expect(recipients).not.toContain(users.coordinator.email);
      expect(sendEmail.mock.calls[0][1]).toBe(`Venue booking requested: ${VENUE_NAME}`);
    });

    it("carries the event's requirements in the notification, and never its name (AC2)", async () => {
      await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      const html = await render(sendEmail.mock.calls[0][2]);

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

    it("keeps the request when the notification fails", async () => {
      sendEmail.mockRejectedValue(new Error("smtp is down"));

      const request = await handleCreateVenueRequest(
        { ...WINDOW, eventId, venueId },
        session(users.coordinator),
        database as never
      );

      const rows = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, request.id));
      expect(rows).toHaveLength(1);
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
        { status: "pending" },
        { status: "pending" },
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
});
