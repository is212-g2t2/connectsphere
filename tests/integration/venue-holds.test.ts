// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleConvertVenueHold,
  handleCreateVenueHold,
  handleReleaseVenueHold,
} from "#/features/venue-requests/holds.server";
import { handleAmendVenueBooking } from "#/features/venue-requests/bookings.server";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
  handleGetPendingVenueRequest,
} from "#/features/venue-requests/requests.server";
import { handleGetVenueAvailability, handleSearchVenues } from "#/features/venues/records.server";
import { handleListEvents } from "#/features/events/records.server";
import { VENUE_REQUEST_DUPLICATE_MESSAGE } from "#/features/venue-requests/schema";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/**
 * PTR-109: tentative venue holds at the handler boundary.
 *
 * Acceptance criteria under test:
 *   AC1 — Coordinator assigned to event places hold → recorded against that event
 *   AC2 — Overlapping hold refused, conflicting venue and period named
 *   AC3 — Booking approval refused while tentative hold exists
 *   AC4 — Tentative hold refused while approved booking exists
 *   AC5 — Releasing or converting hold frees period; hold no longer blocks other events
 *   AC6 — Tentative hold shown on venue calendar and in suitability checks to internal users
 *   AC7 — Acting user and creation time are stored
 */

const users = {
  organiser: {
    id: "ptr109-hold-organiser",
    name: "PTR-109 Organiser",
    email: "ptr109-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinatorA: {
    id: "ptr109-hold-coordinator-a",
    name: "PTR-109 Coordinator A",
    email: "ptr109-coordinator-a@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  coordinatorB: {
    id: "ptr109-hold-coordinator-b",
    name: "PTR-109 Coordinator B",
    email: "ptr109-coordinator-b@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "ptr109-hold-venue-staff",
    name: "PTR-109 Venue Staff",
    email: "ptr109-venue-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const VENUE_NAME = "PTR-109 Auditorium";
const VENUE_NAME_B = "PTR-109 Annex";
const userIds = Object.values(users).map(user => user.id);

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const HOLD_WINDOW = {
  date: "2027-06-15",
  startTime: "09:00",
  endTime: "12:00",
};

describe("tentative venue holds (PTR-109)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;
  let eventIdA: number;
  let eventIdB: number;
  let underReviewEventId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  afterAll(async () => {
    await database.delete(schema.venueHolds).where(eq(schema.venueHolds.venueId, venueId));
    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, [users.organiser.id]));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME_B));
    await database.delete(schema.user).where(inArray(schema.user.id, userIds));
    await pool.end();
  });

  beforeEach(async () => {
    await database.delete(schema.venueHolds).where(eq(schema.venueHolds.venueId, venueId));

    await database
      .delete(schema.eventRequests)
      .where(inArray(schema.eventRequests.organiserId, [users.organiser.id]));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME_B));

    const [insertedVenue] = await database
      .insert(schema.venues)
      .values({
        name: VENUE_NAME,
        location: "PTR-109 Wing",
        maxCapacity: 300,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    venueId = insertedVenue.id;

    const [eventA] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinatorA.id,
        assignedAt: new Date(),
        eventName: "PTR-109 Event A",
        proposedDates: [{ start: "2027-06-15T09:00", end: "2027-06-15T12:00" }],
        expectedAttendance: 100,
      })
      .returning({ id: schema.eventRequests.id });
    eventIdA = eventA.id;

    const [eventB] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinatorB.id,
        assignedAt: new Date(),
        eventName: "PTR-109 Event B",
        proposedDates: [{ start: "2027-06-15T10:00", end: "2027-06-15T14:00" }],
      })
      .returning({ id: schema.eventRequests.id });
    eventIdB = eventB.id;

    const [underReview] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "under_review",
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinatorA.id,
        assignedAt: new Date(),
        eventName: "PTR-109 Under Review Event",
      })
      .returning({ id: schema.eventRequests.id });
    underReviewEventId = underReview.id;
  });

  // ---------------------------------------------------------------------------
  // AC1, AC7 — placing a hold & database persistence
  // ---------------------------------------------------------------------------
  describe("placing a tentative hold (AC1, AC7)", () => {
    it("records a tentative hold against the event and persists in database (TC01)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      expect(hold).toMatchObject({
        eventId: eventIdA,
        venueId,
        status: "held",
      });
      expect(hold.startsAt).toMatch(/^2027-06-15[ T]09:00/);
      expect(hold.endsAt).toMatch(/^2027-06-15[ T]12:00/);

      // Verify row is persisted in the database, not just returned in-memory
      const result = await database.execute<{
        id: string;
        event_id: number;
        venue_id: number;
        status: string;
      }>(sql`SELECT id, event_id, venue_id, status FROM venue_holds WHERE id = ${hold.id}`);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].event_id).toBe(eventIdA);
      expect(result.rows[0].venue_id).toBe(venueId);
      expect(result.rows[0].status).toBe("held");
    });

    it("stores the acting user id and a recent timestamp in the database (TC02)", async () => {
      const before = new Date();

      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      expect(hold.heldById).toBe(users.coordinatorA.id);
      expect(hold.createdAt).toBeInstanceOf(Date);
      expect(hold.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 30_000);

      // Verify DB storage of user and creation time
      const result = await database.execute<{
        held_by_id: string;
        created_at: string | Date;
      }>(sql`SELECT held_by_id, created_at FROM venue_holds WHERE id = ${hold.id}`);
      expect(result.rows[0].held_by_id).toBe(users.coordinatorA.id);
      expect(new Date(result.rows[0].created_at).getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 30_000
      );
    });
  });

  // ---------------------------------------------------------------------------
  // AC2 — overlapping hold refusal naming venue and period
  // ---------------------------------------------------------------------------
  describe("refusing overlapping holds (AC2)", () => {
    it("refuses a second hold by the same event, naming conflicting venue and period (TC03)", async () => {
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const promise = handleCreateVenueHold(
        { ...HOLD_WINDOW, startTime: "11:00", endTime: "14:00", eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await expect(promise).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: expect.stringContaining(VENUE_NAME),
      });
      await expect(promise).rejects.toSatisfy((err: Error) => {
        return (
          err.message.includes(VENUE_NAME) &&
          err.message.includes("09:00") &&
          err.message.includes("12:00")
        );
      });
    });

    it("refuses a hold by a different event, naming conflicting venue and period (TC04)", async () => {
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const promise = handleCreateVenueHold(
        { ...HOLD_WINDOW, startTime: "10:00", endTime: "13:00", eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      await expect(promise).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: expect.stringContaining(VENUE_NAME),
      });
      await expect(promise).rejects.toSatisfy((err: Error) => {
        return (
          err.message.includes(VENUE_NAME) &&
          err.message.includes("09:00") &&
          err.message.includes("12:00")
        );
      });
    });

    it("allows holds that only touch at the boundary (TC09)", async () => {
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, startTime: "12:00", endTime: "15:00", eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      expect(hold.status).toBe("held");
    });

    it("resolves concurrent holds safely: exactly one recorded, loser refused with venue and period (TC16)", async () => {
      const results = await Promise.allSettled([
        handleCreateVenueHold(
          { ...HOLD_WINDOW, eventId: eventIdA, venueId },
          session(users.coordinatorA),
          database as never
        ),
        handleCreateVenueHold(
          { ...HOLD_WINDOW, startTime: "11:00", endTime: "14:00", eventId: eventIdB, venueId },
          session(users.coordinatorB),
          database as never
        ),
      ]);

      const fulfilled = results.filter(r => r.status === "fulfilled");
      const rejected = results.filter(r => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rejection = rejected[0];
      expect(rejection.reason).toMatchObject({
        name: "ConflictError",
        status: 409,
      });
      expect(rejection.reason.message).toContain(VENUE_NAME);
    });
  });

  // ---------------------------------------------------------------------------
  // AC4 — hold vs approved booking
  // ---------------------------------------------------------------------------
  describe("hold vs approved booking (AC4)", () => {
    it("refuses hold when approved booking exists, naming conflicting venue and period (TC05)", async () => {
      const request = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );
      await handleApproveVenueRequest(
        { id: request.id },
        session(users.venueStaff),
        database as never
      );

      const promise = handleCreateVenueHold(
        { ...HOLD_WINDOW, startTime: "10:00", endTime: "13:00", eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      await expect(promise).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: expect.stringContaining(VENUE_NAME),
      });
      await expect(promise).rejects.toSatisfy((err: Error) => {
        return (
          err.message.includes(VENUE_NAME) &&
          err.message.includes("09:00") &&
          err.message.includes("12:00")
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // AC3 — approval vs tentative hold
  // ---------------------------------------------------------------------------
  describe("approval vs tentative hold (AC3)", () => {
    it("refuses booking approval while hold exists, naming venue and period (TC06)", async () => {
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const request = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, startTime: "10:00", endTime: "14:00", eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      const promise = handleApproveVenueRequest(
        { id: request.id },
        session(users.venueStaff),
        database as never
      );

      await expect(promise).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: expect.stringContaining(VENUE_NAME),
      });
      await expect(promise).rejects.toSatisfy((err: Error) => {
        return (
          err.message.includes(VENUE_NAME) &&
          err.message.includes("09:00") &&
          err.message.includes("12:00")
        );
      });

      const [row] = await database
        .select({ status: schema.venueRequests.status })
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, request.id));
      expect(row.status).toBe("pending");
    });

    it("allows the approval once the overlapping hold is released, proving the slot frees (AC3)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const request = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, startTime: "10:00", endTime: "14:00", eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      await handleReleaseVenueHold({ id: hold.id }, session(users.coordinatorA), database as never);

      const approved = await handleApproveVenueRequest(
        { id: request.id },
        session(users.venueStaff),
        database as never
      );
      expect(approved.status).toBe("approved");
    });
  });

  // ---------------------------------------------------------------------------
  // Amendment onto an active hold — the booking writer's half of the guarantee
  // ---------------------------------------------------------------------------
  describe("amending a booking onto an active hold", () => {
    it("refuses the amendment, naming the held venue and period, and keeps the booking", async () => {
      const request = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );
      await handleApproveVenueRequest(
        { id: request.id },
        session(users.venueStaff),
        database as never
      );
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, startTime: "13:00", endTime: "15:00", eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      const promise = handleAmendVenueBooking(
        {
          id: request.id,
          venueId,
          date: HOLD_WINDOW.date,
          startTime: "13:00",
          endTime: "15:00",
        },
        session(users.venueStaff),
        database as never
      );

      await expect(promise).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: expect.stringContaining(VENUE_NAME),
      });
      await expect(promise).rejects.toSatisfy((err: Error) => {
        return (
          err.message.includes(VENUE_NAME) &&
          err.message.includes("13:00") &&
          err.message.includes("15:00")
        );
      });

      const [row] = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, request.id));
      expect(row).toMatchObject({
        status: "approved",
        venueId,
        startsAt: `${HOLD_WINDOW.date} 09:00:00`,
        endsAt: `${HOLD_WINDOW.date} 12:00:00`,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // AC5 — releasing a tentative hold
  // ---------------------------------------------------------------------------
  describe("releasing a tentative hold (AC5)", () => {
    it("releases a hold and frees the period for another event (TC07)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const released = await handleReleaseVenueHold(
        { id: hold.id },
        session(users.coordinatorA),
        database as never
      );
      expect(released.status).toBe("released");

      // Verify releasedById was stored (AC7)
      const [persistedHold] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(persistedHold.releasedById).toBe(users.coordinatorA.id);

      // Another event can now hold the same period
      const newHold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );
      expect(newHold.status).toBe("held");
    });

    it("allows release by the event's assigned Coordinator even if hold was placed by another Coordinator", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      // Reassign event to Coordinator B
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.coordinatorB.id })
        .where(eq(schema.eventRequests.id, eventIdA));

      const released = await handleReleaseVenueHold(
        { id: hold.id },
        session(users.coordinatorB),
        database as never
      );
      expect(released.status).toBe("released");

      const [persisted] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(persisted.releasedById).toBe(users.coordinatorB.id);
    });

    it("lets the original holder release after the event is reassigned", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      // Reassign event to Coordinator B: the creator is no longer the assignee, but release
      // authorizes on the hold's holder as well as the current assignee.
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.coordinatorB.id })
        .where(eq(schema.eventRequests.id, eventIdA));

      const released = await handleReleaseVenueHold(
        { id: hold.id },
        session(users.coordinatorA),
        database as never
      );
      expect(released.status).toBe("released");

      const [persisted] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(persisted.releasedById).toBe(users.coordinatorA.id);
    });

    it("refuses release by a Coordinator who is neither creator nor assigned to event (TC15)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await expect(
        handleReleaseVenueHold({ id: hold.id }, session(users.coordinatorB), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });

    it("releases an orphaned hold whose creator and assignee are both gone", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await database
        .update(schema.venueHolds)
        .set({ heldById: null })
        .where(eq(schema.venueHolds.id, hold.id));
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: null })
        .where(eq(schema.eventRequests.id, eventIdA));

      const availability = await handleGetVenueAvailability(
        { venueId, startDate: HOLD_WINDOW.date, endDate: HOLD_WINDOW.date },
        users.coordinatorB.id,
        database as never
      );
      const orphanHold = availability?.occupied.find(entry => entry.id === hold.id);
      expect(orphanHold?.canRelease).toBe(true);
      expect(orphanHold?.canConvert).toBe(false);

      // No owner on either side, so any coordinator reaching the hold may free it.
      const released = await handleReleaseVenueHold(
        { id: hold.id },
        session(users.coordinatorB),
        database as never
      );
      expect(released.status).toBe("released");
    });

    it("still refuses an unrelated coordinator when the hold has an owner", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await expect(
        handleReleaseVenueHold({ id: hold.id }, session(users.coordinatorB), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });

    it("refuses releasing an already released hold (TC17)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await handleReleaseVenueHold({ id: hold.id }, session(users.coordinatorA), database as never);

      await expect(
        handleReleaseVenueHold({ id: hold.id }, session(users.coordinatorA), database as never)
      ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
    });

    it("refuses releasing a non-existent hold id (TC18)", async () => {
      await expect(
        handleReleaseVenueHold(
          { id: "non-existent-hold-id" },
          session(users.coordinatorA),
          database as never
        )
      ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    });
  });

  // ---------------------------------------------------------------------------
  // AC5 — converting a tentative hold to a booking request
  // ---------------------------------------------------------------------------
  describe("converting a tentative hold to a venue booking request (AC5)", () => {
    it("converts hold to request with matching period, releases hold, and notifies Venue Staff (TC08)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const result = await handleConvertVenueHold(
        { id: hold.id },
        session(users.coordinatorA),
        database as never
      );

      expect(result.hold.status).toBe("released");
      expect(result.request).toMatchObject({
        eventId: eventIdA,
        venueId,
        status: "pending",
      });
      expect(result.request.startsAt).toMatch(/^2027-06-15[ T]09:00/);
      expect(result.request.endsAt).toMatch(/^2027-06-15[ T]12:00/);

      // The conversion queues a booking-request notification for Venue Staff
      const queued = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.recipientId, users.venueStaff.id));
      expect(queued).toHaveLength(1);
      expect(queued[0].kind).toBe("venue_booking_requested");
      expect(queued[0].emailedAt).toBeNull();
      expect(queued[0].eventRequestId).toBe(eventIdA);
      expect(queued[0].payload).toMatchObject({
        venueRequestId: result.request.id,
        venueName: VENUE_NAME,
      });

      // Verify DB persistence of the new venue request and released hold
      const [persistedHold] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(persistedHold.status).toBe("released");
      expect(persistedHold.releasedById).toBe(users.coordinatorA.id);

      const [persistedRequest] = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, result.request.id));
      expect(persistedRequest).toBeDefined();
      expect(persistedRequest.status).toBe("pending");
      expect(persistedRequest.eventId).toBe(eventIdA);
      expect(persistedRequest.venueId).toBe(venueId);
    });

    it("allows convert by the event's assigned Coordinator even if hold was placed by another Coordinator", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      // Reassign event to Coordinator B
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.coordinatorB.id })
        .where(eq(schema.eventRequests.id, eventIdA));

      const result = await handleConvertVenueHold(
        { id: hold.id },
        session(users.coordinatorB),
        database as never
      );
      expect(result.hold.status).toBe("released");
      expect(result.request.status).toBe("pending");

      const [persistedHold] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(persistedHold.releasedById).toBe(users.coordinatorB.id);
    });

    it("refuses convert by a Coordinator who is neither creator nor assigned to event (TC19)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await expect(
        handleConvertVenueHold({ id: hold.id }, session(users.coordinatorB), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });

    it("refuses conversion when the event has left submitted and leaves the hold held", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      // The creator is still the assignee, but the event has moved past the holdable status.
      await database
        .update(schema.eventRequests)
        .set({ status: "under_review" })
        .where(eq(schema.eventRequests.id, eventIdA));

      await expect(
        handleConvertVenueHold({ id: hold.id }, session(users.coordinatorA), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });

      // The refusal rolled the release back: the hold is not left dangling as "released".
      const [persisted] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(persisted.status).toBe("held");
    });

    it("refuses conversion when the event+venue already has a pending request, leaving the hold held and releasable", async () => {
      // The pending request comes first: hold creation never checks pending rows, so the hold
      // still lands and the duplicate surfaces only at conversion.
      await handleCreateVenueRequest(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await expect(
        handleConvertVenueHold({ id: hold.id }, session(users.coordinatorA), database as never)
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: VENUE_REQUEST_DUPLICATE_MESSAGE,
      });

      // The refusal rolled the release back: the hold stays held and can still be released.
      const [persisted] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(persisted.status).toBe("held");

      const released = await handleReleaseVenueHold(
        { id: hold.id },
        session(users.coordinatorA),
        database as never
      );
      expect(released.status).toBe("released");
    });

    it("refuses converting an already released or converted hold (TC20)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await handleConvertVenueHold({ id: hold.id }, session(users.coordinatorA), database as never);

      await expect(
        handleConvertVenueHold({ id: hold.id }, session(users.coordinatorA), database as never)
      ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
    });

    it("refuses converting a non-existent hold id (TC21)", async () => {
      await expect(
        handleConvertVenueHold(
          { id: "non-existent-hold-id" },
          session(users.coordinatorA),
          database as never
        )
      ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    });
  });

  // ---------------------------------------------------------------------------
  // AC6 — calendar and suitability visibility
  // ---------------------------------------------------------------------------
  describe("calendar and suitability visibility (AC6)", () => {
    it("includes held period in venue availability calendar (TC10)", async () => {
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const availability = await handleGetVenueAvailability(
        { venueId, startDate: HOLD_WINDOW.date, endDate: HOLD_WINDOW.date },
        users.coordinatorA.id,
        database as never
      );

      expect(availability?.occupied).toContainEqual(
        expect.objectContaining({
          state: "tentative_hold",
          startsAt: `${HOLD_WINDOW.date}T09:00:00`,
          endsAt: `${HOLD_WINDOW.date}T12:00:00`,
        })
      );
    });

    it("stops showing period as tentatively held on calendar after release (TC14)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await handleReleaseVenueHold({ id: hold.id }, session(users.coordinatorA), database as never);

      const availability = await handleGetVenueAvailability(
        { venueId, startDate: HOLD_WINDOW.date, endDate: HOLD_WINDOW.date },
        users.coordinatorA.id,
        database as never
      );
      if (!availability) throw new Error("expected venue availability after hold release");

      const holdEntries = availability.occupied.filter(
        (entry: { state: string }) => entry.state === "tentative_hold"
      );
      expect(holdEntries).toHaveLength(0);
    });

    it("shows venue as tentatively held in venue search / suitability check (TC22)", async () => {
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const search = await handleSearchVenues(
        { date: HOLD_WINDOW.date, startTime: "09:00", endTime: "12:00" },
        session(users.coordinatorB),
        database as never
      );

      expect(search.venues.map(v => v.id)).not.toContain(venueId);
      const verdict = search.unsuitable.find(({ venue }) => venue.id === venueId);
      expect(verdict?.failures).toContainEqual({
        criterion: "hold",
        message: "Tentatively held on 2027-06-15",
      });
    });

    it("shows venue as suitable again in venue search after hold is released (TC23)", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      await handleReleaseVenueHold({ id: hold.id }, session(users.coordinatorA), database as never);

      const search = await handleSearchVenues(
        { date: HOLD_WINDOW.date, startTime: "09:00", endTime: "12:00" },
        session(users.coordinatorB),
        database as never
      );

      expect(search.venues.map(v => v.id)).toContain(venueId);
    });

    it("reports canRelease and canConvert based on hold ownership, event status, and viewer", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      // Assigned coordinator on a submitted event: canRelease=true, canConvert=true
      const coordAvailability = await handleGetVenueAvailability(
        { venueId, startDate: HOLD_WINDOW.date, endDate: HOLD_WINDOW.date },
        users.coordinatorA.id,
        database as never
      );
      const coordHold = coordAvailability?.occupied.find(entry => entry.id === hold.id);
      expect(coordHold?.canRelease).toBe(true);
      expect(coordHold?.canConvert).toBe(true);

      // Unassigned viewer: canRelease=false, canConvert=false
      const unassignedAvailability = await handleGetVenueAvailability(
        { venueId, startDate: HOLD_WINDOW.date, endDate: HOLD_WINDOW.date },
        users.coordinatorB.id,
        database as never
      );
      const unassignedHold = unassignedAvailability?.occupied.find(entry => entry.id === hold.id);
      expect(unassignedHold?.canRelease).toBe(false);
      expect(unassignedHold?.canConvert).toBe(false);

      // Event moves past "submitted": assigned coordinator has canRelease=true, canConvert=false
      await database
        .update(schema.eventRequests)
        .set({ status: "under_review" })
        .where(eq(schema.eventRequests.id, eventIdA));

      const movedAvailability = await handleGetVenueAvailability(
        { venueId, startDate: HOLD_WINDOW.date, endDate: HOLD_WINDOW.date },
        users.coordinatorA.id,
        database as never
      );
      const movedHold = movedAvailability?.occupied.find(entry => entry.id === hold.id);
      expect(movedHold?.canRelease).toBe(true);
      expect(movedHold?.canConvert).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Coordinator event card and convert suppression
  // ---------------------------------------------------------------------------
  describe("coordinator event card and convert suppression", () => {
    it("flags the Coordinator's pending request as conflicting when it overlaps an active hold", async () => {
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );
      await handleCreateVenueRequest(
        { ...HOLD_WINDOW, startTime: "10:00", endTime: "14:00", eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const [projection] = await handleListEvents(
        { eventId: eventIdA },
        session(users.coordinatorA),
        database as never
      );
      expect(projection.event.venueRequest).toEqual({
        id: expect.any(String),
        status: "pending",
        conflict: "hold",
        venueName: "PTR-109 Auditorium",
      });
    });

    it("suppresses canConvert once the event+venue already has a pending request", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );
      await handleCreateVenueRequest(
        { ...HOLD_WINDOW, startTime: "14:00", endTime: "16:00", eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const availability = await handleGetVenueAvailability(
        { venueId, startDate: HOLD_WINDOW.date, endDate: HOLD_WINDOW.date },
        users.coordinatorA.id,
        database as never
      );
      const entry = availability?.occupied.find(period => period.id === hold.id);
      // Release stays offered, but Convert would land straight in the pending-request refusal.
      expect(entry?.canRelease).toBe(true);
      expect(entry?.canConvert).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Conflict-kind projection (PTR-32) — hold vs booking vs clear
  // ---------------------------------------------------------------------------
  describe("pending-request conflict kinds", () => {
    it("reports a hold-kind conflict for a pending request overlapping an active hold", async () => {
      await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );

      const request = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, startTime: "10:00", endTime: "14:00", eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      const detail = await handleGetPendingVenueRequest({ id: request.id }, database as never);
      expect(detail?.conflict).toBe("hold");
    });

    it("reports a booking-kind conflict for a pending request overlapping an approved booking", async () => {
      const booking = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );
      await handleApproveVenueRequest(
        { id: booking.id },
        session(users.venueStaff),
        database as never
      );

      const request = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, startTime: "10:00", endTime: "14:00", eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      const detail = await handleGetPendingVenueRequest({ id: request.id }, database as never);
      expect(detail?.conflict).toBe("booking");
    });
  });

  /**
   * Genuine-concurrency barrier: a session-level advisory lock on the venue is held while both
   * writers start, so neither can finish before the other begins. Both block on the venue lock
   * inside their transactions; releasing the gate lets them contend for real. Without this, one
   * writer could commit before the other starts and the "race" would prove nothing. Callers
   * assert the post-race invariant, never which writer won.
   */
  async function raceForVenue<A, B>(
    contenderA: () => Promise<A>,
    contenderB: () => Promise<B>
  ): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
    const gate = new Pool({ connectionString: process.env.DATABASE_URL });
    const gateClient = await gate.connect();
    try {
      await gateClient.query("SELECT pg_advisory_lock($1::integer)", [venueId]);
      const pending = Promise.allSettled([contenderA(), contenderB()]);
      try {
        await vi.waitFor(
          async () => {
            // This venue's key only: writers take single-bigint xact locks (classid 0, objid
            // the venue id, objsubid 1 — verified against pg_locks), so other suites' venues
            // sharing the cluster never satisfy the barrier early.
            const waiting = await database.execute<{ count: string }>(
              sql`SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND classid = 0 AND objid = ${venueId} AND objsubid = 1`
            );
            expect(Number(waiting.rows[0].count)).toBeGreaterThanOrEqual(2);
          },
          { timeout: 10_000, interval: 25 }
        );
      } finally {
        await gateClient.query("SELECT pg_advisory_unlock($1::integer)", [venueId]);
      }
      return pending;
    } finally {
      gateClient.release();
      await gate.end();
    }
  }

  // ---------------------------------------------------------------------------
  // Concurrent hold write vs approval — the advisory-lock guarantee
  // ---------------------------------------------------------------------------
  describe("concurrent hold write and approval", () => {
    it("never leaves a held hold and an approved booking for the same venue and period", async () => {
      const request = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      const results = await raceForVenue(
        () =>
          handleCreateVenueHold(
            { ...HOLD_WINDOW, eventId: eventIdA, venueId },
            session(users.coordinatorA),
            database as never
          ),
        () =>
          handleApproveVenueRequest(
            { id: request.id },
            session(users.venueStaff),
            database as never
          )
      );

      // The advisory lock serialises the two writers: one wins, the other is refused.
      const fulfilled = results.filter(result => result.status === "fulfilled");
      const rejected = results.filter(result => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({ name: "ConflictError", status: 409 });

      const windowStart = `${HOLD_WINDOW.date} ${HOLD_WINDOW.startTime}:00`;
      const windowEnd = `${HOLD_WINDOW.date} ${HOLD_WINDOW.endTime}:00`;
      const [heldRows, approvedRows] = await Promise.all([
        database
          .select({ startsAt: schema.venueHolds.startsAt, endsAt: schema.venueHolds.endsAt })
          .from(schema.venueHolds)
          .where(and(eq(schema.venueHolds.venueId, venueId), eq(schema.venueHolds.status, "held"))),
        database
          .select({ startsAt: schema.venueRequests.startsAt, endsAt: schema.venueRequests.endsAt })
          .from(schema.venueRequests)
          .where(
            and(
              eq(schema.venueRequests.venueId, venueId),
              eq(schema.venueRequests.status, "approved")
            )
          ),
      ]);
      const overlaps = (row: { startsAt: string; endsAt: string }) =>
        row.startsAt < windowEnd && row.endsAt > windowStart;
      const held = heldRows.some(overlaps);
      const approved = approvedRows.some(overlaps);
      // The guarantee: the two states never coexist for the same venue and period.
      expect(held && approved).toBe(false);
      // And exactly one of the two writes survived.
      expect(held !== approved).toBe(true);
    });

    it("never leaves a held hold and an approved booking when converting races an approval", async () => {
      const hold = await handleCreateVenueHold(
        { ...HOLD_WINDOW, eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );
      const request = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, eventId: eventIdB, venueId },
        session(users.coordinatorB),
        database as never
      );

      const [convertOutcome, approveOutcome] = await raceForVenue(
        () =>
          handleConvertVenueHold({ id: hold.id }, session(users.coordinatorA), database as never),
        () =>
          handleApproveVenueRequest(
            { id: request.id },
            session(users.venueStaff),
            database as never
          )
      );

      // The convert only needs its own hold, so it always lands; the approval lands only when its
      // pre-check runs after the release. Either order is valid — pending requests stack — but a
      // held hold and an approved booking must never coexist for the slot.
      expect(convertOutcome.status).toBe("fulfilled");
      // The approval either lands (its pre-check ran after the release) or is refused as
      // conflicting (it ran before); both are valid, so only a non-conflict outcome fails.
      const approveError = approveOutcome.status === "rejected" ? approveOutcome.reason : null;
      expect(
        approveError === null ||
          (approveError instanceof Error &&
            approveError.name === "ConflictError" &&
            (approveError as { status?: number }).status === 409)
      ).toBe(true);

      const windowStart = `${HOLD_WINDOW.date} ${HOLD_WINDOW.startTime}:00`;
      const windowEnd = `${HOLD_WINDOW.date} ${HOLD_WINDOW.endTime}:00`;
      const [heldRows, approvedRows] = await Promise.all([
        database
          .select({ startsAt: schema.venueHolds.startsAt, endsAt: schema.venueHolds.endsAt })
          .from(schema.venueHolds)
          .where(and(eq(schema.venueHolds.venueId, venueId), eq(schema.venueHolds.status, "held"))),
        database
          .select({ startsAt: schema.venueRequests.startsAt, endsAt: schema.venueRequests.endsAt })
          .from(schema.venueRequests)
          .where(
            and(
              eq(schema.venueRequests.venueId, venueId),
              eq(schema.venueRequests.status, "approved")
            )
          ),
      ]);
      const overlaps = (row: { startsAt: string; endsAt: string }) =>
        row.startsAt < windowEnd && row.endsAt > windowStart;
      expect(heldRows.some(overlaps) && approvedRows.some(overlaps)).toBe(false);
    });

    it("races two opposite-direction amendments without deadlocking (40P01)", async () => {
      // A second venue, created after the suite venue so its id sorts after it: both amendments
      // lock the pair in the same sorted order and queue instead of deadlocking.
      const [venueB] = await database
        .insert(schema.venues)
        .values({
          name: VENUE_NAME_B,
          location: "PTR-109 Annex Wing",
          maxCapacity: 150,
          operatingHours: DEFAULT_OPERATING_HOURS,
        })
        .returning({ id: schema.venues.id });
      const venueIdB = venueB.id;

      // Disjoint windows, so either amendment's target pre-check passes whichever order wins: both
      // succeed and the bookings swap venues.
      const requestA = await handleCreateVenueRequest(
        { ...HOLD_WINDOW, startTime: "09:00", endTime: "10:00", eventId: eventIdA, venueId },
        session(users.coordinatorA),
        database as never
      );
      await handleApproveVenueRequest(
        { id: requestA.id },
        session(users.venueStaff),
        database as never
      );
      const requestB = await handleCreateVenueRequest(
        {
          ...HOLD_WINDOW,
          startTime: "14:00",
          endTime: "15:00",
          eventId: eventIdB,
          venueId: venueIdB,
        },
        session(users.coordinatorB),
        database as never
      );
      await handleApproveVenueRequest(
        { id: requestB.id },
        session(users.venueStaff),
        database as never
      );

      const results = await raceForVenue(
        () =>
          handleAmendVenueBooking(
            {
              id: requestA.id,
              venueId: venueIdB,
              date: HOLD_WINDOW.date,
              startTime: "09:00",
              endTime: "10:00",
            },
            session(users.venueStaff),
            database as never
          ),
        () =>
          handleAmendVenueBooking(
            {
              id: requestB.id,
              venueId,
              date: HOLD_WINDOW.date,
              startTime: "14:00",
              endTime: "15:00",
            },
            session(users.venueStaff),
            database as never
          )
      );

      // Either both succeed or the loser carries a mapped refusal: a deadlock (40P01) or an
      // unmapped 500 fails here.
      for (const result of results) {
        if (result.status === "fulfilled") continue;
        const reason = result.reason as Error & { status?: number; cause?: { code?: string } };
        expect([409, 403, 404]).toContain(reason?.status);
        expect(reason?.cause?.code).not.toBe("40P01");
        expect(reason?.message ?? "").not.toMatch(/40P01|deadlock/i);
      }
      expect(results.some(result => result.status === "fulfilled")).toBe(true);

      const [bookingA] = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, requestA.id));
      const [bookingB] = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, requestB.id));
      for (const booking of [bookingA, bookingB]) {
        expect(booking.status).toBe("approved");
        expect([venueId, venueIdB]).toContain(booking.venueId);
      }
      // One venue ends with each booking's own disjoint window: swap or no-op, never stacked.
      const approved = await database
        .select({
          venueId: schema.venueRequests.venueId,
          startsAt: schema.venueRequests.startsAt,
          endsAt: schema.venueRequests.endsAt,
        })
        .from(schema.venueRequests)
        .where(
          and(
            inArray(schema.venueRequests.venueId, [venueId, venueIdB]),
            eq(schema.venueRequests.status, "approved")
          )
        );
      for (let i = 0; i < approved.length; i++) {
        for (let j = i + 1; j < approved.length; j++) {
          const a = approved[i];
          const b = approved[j];
          const stacked = a.venueId === b.venueId && a.startsAt < b.endsAt && b.startsAt < a.endsAt;
          expect(stacked).toBe(false);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Authorization and validation guards (AC1)
  // ---------------------------------------------------------------------------
  describe("authorization and validation guards (AC1)", () => {
    it("refuses a Coordinator not assigned to the event (TC11)", async () => {
      await expect(
        handleCreateVenueHold(
          { ...HOLD_WINDOW, eventId: eventIdA, venueId },
          session(users.coordinatorB), // not assigned to Event A
          database as never
        )
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });

    it("refuses a hold on a non-existent venue (TC12)", async () => {
      await expect(
        handleCreateVenueHold(
          { ...HOLD_WINDOW, eventId: eventIdA, venueId: 987_654 },
          session(users.coordinatorA),
          database as never
        )
      ).rejects.toMatchObject({ name: "NotFoundError", status: 404, message: "Not Found" });
    });

    it("refuses a hold when the event is not in a holdable status (TC13)", async () => {
      // Note: Infers the same status gate as handleCreateVenueRequest (must be in "submitted" status)
      await expect(
        handleCreateVenueHold(
          { ...HOLD_WINDOW, eventId: underReviewEventId, venueId },
          session(users.coordinatorA),
          database as never
        )
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403, message: "Forbidden" });
    });
  });

  // ---------------------------------------------------------------------------
  // DB exclusion constraint tests (PTR-109 / ADR-5)
  // ---------------------------------------------------------------------------
  describe("the venue_holds_no_overlap exclusion constraint itself (ADR-5)", () => {
    it("refuses a second overlapping active hold directly at the database", async () => {
      await database.insert(schema.venueHolds).values({
        id: "ptr-109-direct-1",
        eventId: eventIdA,
        venueId,
        startsAt: "2027-06-15 09:00:00",
        endsAt: "2027-06-15 12:00:00",
        status: "held",
        heldById: users.coordinatorA.id,
      });

      await expect(
        database.insert(schema.venueHolds).values({
          id: "ptr-109-direct-2",
          eventId: eventIdB,
          venueId,
          startsAt: "2027-06-15 11:00:00",
          endsAt: "2027-06-15 14:00:00",
          status: "held",
          heldById: users.coordinatorB.id,
        })
      ).rejects.toMatchObject({
        cause: { code: "23P01", constraint: "venue_holds_no_overlap" },
      });
    });

    it("allows boundary-touching holds and overlapping holds when one is released", async () => {
      await database.insert(schema.venueHolds).values({
        id: "ptr-109-direct-3",
        eventId: eventIdA,
        venueId,
        startsAt: "2027-06-15 09:00:00",
        endsAt: "2027-06-15 12:00:00",
        status: "held",
        heldById: users.coordinatorA.id,
      });

      // Boundary touch (12:00 to 14:00) should succeed
      const [touching] = await database
        .insert(schema.venueHolds)
        .values({
          id: "ptr-109-direct-4",
          eventId: eventIdB,
          venueId,
          startsAt: "2027-06-15 12:00:00",
          endsAt: "2027-06-15 14:00:00",
          status: "held",
          heldById: users.coordinatorB.id,
        })
        .returning();
      expect(touching.id).toBe("ptr-109-direct-4");

      // Overlapping hold for the same period but with status 'released' should succeed
      const [released] = await database
        .insert(schema.venueHolds)
        .values({
          id: "ptr-109-direct-5",
          eventId: eventIdB,
          venueId,
          startsAt: "2027-06-15 09:00:00",
          endsAt: "2027-06-15 12:00:00",
          status: "released",
          heldById: users.coordinatorB.id,
        })
        .returning();
      expect(released.id).toBe("ptr-109-direct-5");
    });
  });

  // ---------------------------------------------------------------------------
  // Account deletion resilience & coordinator reassignment
  // ---------------------------------------------------------------------------
  describe("account deletion resilience (ON DELETE SET NULL) and coordinator assignment", () => {
    it("sets held_by_id and released_by_id to null when users are deleted without breaking hold management", async () => {
      const tempCoordAId = "ptr109-temp-coord-a";
      const tempCoordBId = "ptr109-temp-coord-b";
      await database
        .insert(schema.user)
        .values([
          {
            id: tempCoordAId,
            name: "Temp Coord A",
            email: "temp-coord-a@example.invalid",
            emailVerified: true,
            role: "event_coordinator",
          },
          {
            id: tempCoordBId,
            name: "Temp Coord B",
            email: "temp-coord-b@example.invalid",
            emailVerified: true,
            role: "event_coordinator",
          },
        ])
        .onConflictDoNothing();

      const [event] = await database
        .insert(schema.eventRequests)
        .values({
          organiserId: users.organiser.id,
          status: "submitted",
          submittedAt: new Date(),
          assignedCoordinatorId: tempCoordBId,
          assignedAt: new Date(),
          eventName: "Account Deletion Test Event",
          proposedDates: [{ start: "2027-06-15T09:00", end: "2027-06-15T12:00" }],
        })
        .returning();

      const [hold] = await database
        .insert(schema.venueHolds)
        .values({
          id: "ptr109-hold-deletion-test",
          eventId: event.id,
          venueId,
          startsAt: "2027-06-15 09:00:00",
          endsAt: "2027-06-15 12:00:00",
          status: "held",
          heldById: tempCoordAId,
        })
        .returning();

      // Delete Temp Coord A: held_by_id should become NULL, NOT block deletion
      await database.delete(schema.user).where(eq(schema.user.id, tempCoordAId));

      const [holdAfterDeleteA] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(holdAfterDeleteA.heldById).toBeNull();

      // The assigned coordinator (Temp Coord B) can still release the hold
      const released = await handleReleaseVenueHold(
        { id: hold.id },
        {
          id: tempCoordBId,
          name: "Temp Coord B",
          email: "temp-coord-b@example.invalid",
          role: "event_coordinator",
        },
        database as never
      );
      expect(released.status).toBe("released");

      const [holdAfterRelease] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(holdAfterRelease.releasedById).toBe(tempCoordBId);

      // Now delete Temp Coord B: released_by_id should become NULL, NOT block deletion
      await database.delete(schema.user).where(eq(schema.user.id, tempCoordBId));

      const [holdAfterDeleteB] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, hold.id));
      expect(holdAfterDeleteB.releasedById).toBeNull();
    });
  });
});
