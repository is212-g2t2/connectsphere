// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import { handleListEvents } from "#/features/events/records.server";
import {
  handleDeclineVenueHold,
  handleListVenueHoldRequests,
  handlePlaceVenueHold,
  handleRequestVenueHold,
  handleWithdrawVenueHoldRequest,
} from "#/features/venue-requests/holds.server";
import {
  handleCreateVenueRequest,
  venueRequestEventStatusMessage,
} from "#/features/venue-requests/requests.server";
import {
  VENUE_HOLD_DECLINE_REASON_REQUIRED,
  VENUE_HOLD_EXPIRY_PAST_MESSAGE,
  VENUE_HOLD_REQUEST_HANDLED_MESSAGE,
  isLeftHoldQueueMessage,
  venueHoldConflictMessage,
} from "#/features/venue-requests/schema";
import { toLocalMinuteValue, venueLocalTimestamp } from "#/features/venues/availability";
import { handleGetVenueAvailability } from "#/features/venues/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import { eventStatusColumns } from "./event-status";
import { requestAndPlaceHold } from "./hold-request";

/**
 * PTR-150: Venue Staff place or decline hold requests, tested through the handlers.
 *
 * Acceptance criteria:
 *   AC1: A hold request is `requested`, passes the creation checks, has no occupancy row, and
 *        notifies every Venue Staff user.
 *   AC2: The shared queue shows venue, window and requested time for searchable events.
 *   AC3: Placement re-reads the event, refreshes the buffers, re-checks the venue, stores the
 *        expiry and `placed_by_id`, writes the occupancy row, and notifies the Coordinator.
 *   AC4: Placement refuses an occupied venue or an event outside the searchable statuses.
 *   AC5: Decline stores the reason and the decliner, and notifies the Coordinator.
 *   AC6: The second of two Venue Staff actions is refused.
 */

const users = {
  organiser: {
    id: "ptr150-organiser",
    name: "PTR-150 Organiser",
    email: "ptr150-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "ptr150-coordinator",
    name: "PTR-150 Coordinator",
    email: "ptr150-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  otherCoordinator: {
    id: "ptr150-other-coordinator",
    name: "PTR-150 Other Coordinator",
    email: "ptr150-other-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "ptr150-venue-staff",
    name: "PTR-150 Venue Staff",
    email: "ptr150-venue-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
  otherVenueStaff: {
    id: "ptr150-other-venue-staff",
    name: "PTR-150 Other Venue Staff",
    email: "ptr150-other-venue-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

type TestUser = (typeof users)[keyof typeof users];

const VENUE_NAME = "PTR-150 Auditorium";
const EXPIRY = "2099-06-10T12:00";
const userIds = Object.values(users).map(user => user.id);
const session = (user: TestUser): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
});

describe("hold requests (PTR-150)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let venueId: number;
  let eventId: number;
  let otherEventId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  afterAll(async () => {
    await clean();
    await database.delete(schema.user).where(inArray(schema.user.id, userIds));
    await pool.end();
  });

  async function clean() {
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
  }

  async function insertEvent(name: string, coordinatorId: string) {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        status: "submitted",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinatorId,
        assignedAt: new Date(),
        eventName: name,
        proposedDates: [{ start: "2099-06-15T09:00", end: "2099-06-15T12:00" }],
        expectedAttendance: 100,
      })
      .returning({ id: schema.eventRequests.id });
    return event.id;
  }

  beforeEach(async () => {
    await clean();
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: VENUE_NAME,
        location: "PTR-150 Wing",
        maxCapacity: 300,
        operatingHours: DEFAULT_OPERATING_HOURS,
        setupMinutes: 30,
        turnaroundMinutes: 45,
      })
      .returning({ id: schema.venues.id });
    venueId = venue.id;
    eventId = await insertEvent("PTR-150 Event", users.coordinator.id);
    otherEventId = await insertEvent("PTR-150 Other Event", users.otherCoordinator.id);
  });

  const window = { date: "2099-06-15", startTime: "09:00", endTime: "12:00" };
  const requestHold = (actor: TestUser = users.coordinator, date = window.date) =>
    handleRequestVenueHold(
      { venueId, eventId, ...window, date },
      session(actor),
      database as never
    );
  const place = (id: string, actor: TestUser = users.venueStaff, expiresAt = EXPIRY) =>
    handlePlaceVenueHold({ id, expiresAt }, session(actor), database as never);
  const decline = (id: string, actor: TestUser = users.venueStaff, reason = "Exams that week") =>
    handleDeclineVenueHold({ id, reason }, session(actor), database as never);
  const withdraw = (id: string, actor: TestUser = users.coordinator) =>
    handleWithdrawVenueHoldRequest({ id }, session(actor), database as never);
  const holdRow = async (id: string) => {
    const [row] = await database
      .select()
      .from(schema.venueHolds)
      .where(eq(schema.venueHolds.id, id));
    return row;
  };
  const ledger = (id: string) =>
    database.select().from(schema.venueOccupancy).where(eq(schema.venueOccupancy.venueHoldId, id));
  const notices = (kind: (typeof schema.notificationKind.enumValues)[number]) =>
    database
      .select()
      .from(schema.notifications)
      .where(
        and(
          inArray(schema.notifications.eventRequestId, [eventId, otherEventId]),
          eq(schema.notifications.kind, kind)
        )
      );
  const setEventStatus = (status: (typeof schema.eventRequestStatus.enumValues)[number]) =>
    database
      .update(schema.eventRequests)
      .set(eventStatusColumns(status, users.coordinator))
      .where(eq(schema.eventRequests.id, eventId));

  describe("requesting a hold (AC1)", () => {
    it("stores a requested hold with no occupancy row and notifies every Venue Staff user", async () => {
      const hold = await requestHold();
      expect(hold).toMatchObject({
        status: "requested",
        heldById: users.coordinator.id,
        startsAt: "2099-06-15 09:00:00",
        endsAt: "2099-06-15 12:00:00",
        expiresAt: null,
        placedById: null,
      });
      expect(await ledger(hold.id)).toEqual([]);

      const staff = await database
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.role, "venue_staff"));
      const rows = await notices("venue_hold_requested");
      expect(rows.map(row => row.recipientId).toSorted()).toEqual(
        staff.map(row => row.id).toSorted()
      );
      expect(rows[0].payload).toEqual({
        venueHoldId: hold.id,
        venueName: VENUE_NAME,
        startsAt: "2099-06-15 09:00:00",
        endsAt: "2099-06-15 12:00:00",
      });
    });

    it("applies the hold checks", async () => {
      await requestAndPlaceHold(
        { venueId, eventId: otherEventId, ...window },
        session(users.otherCoordinator),
        database as never
      );
      await expect(requestHold()).rejects.toThrow("tentatively held");
      await expect(requestHold(users.otherCoordinator)).rejects.toThrow("Forbidden");

      await setEventStatus("cancelled");
      await expect(requestHold()).rejects.toThrow(CANCELLED_EVENT_ACTIVITY_MESSAGE);
      expect(
        (await notices("venue_hold_requested")).filter(row => row.eventRequestId === eventId)
      ).toEqual([]);
    });

    it("lets a requested hold leave the venue free for another event", async () => {
      await requestHold();
      const other = await requestAndPlaceHold(
        { venueId, eventId: otherEventId, ...window },
        session(users.otherCoordinator),
        database as never
      );
      expect(other.status).toBe("held");
    });
  });

  describe("the hold-request queue (AC2)", () => {
    it("lists open requests on searchable events with venue, window and requested time", async () => {
      const hold = await requestHold();
      const queue = await handleListVenueHoldRequests(database);
      const entry = queue.find(row => row.id === hold.id);
      expect(entry).toEqual({
        id: hold.id,
        venueName: VENUE_NAME,
        startsAt: "2099-06-15T09:00",
        endsAt: "2099-06-15T12:00",
        requestedAt: toLocalMinuteValue(venueLocalTimestamp(hold.createdAt)),
      });
    });

    it("omits handled requests and events outside the searchable statuses", async () => {
      const placed = await requestHold();
      await place(placed.id);
      const declined = await requestHold(users.coordinator, "2099-06-16");
      await decline(declined.id);
      const confirmed = await requestHold(users.coordinator, "2099-06-17");
      await setEventStatus("confirmed");

      const ids = (await handleListVenueHoldRequests(database)).map(row => row.id);
      expect(ids).not.toContain(placed.id);
      expect(ids).not.toContain(declined.id);
      expect(ids).not.toContain(confirmed.id);
    });
  });

  describe("placing a hold request (AC3)", () => {
    it("holds the venue with the expiry and the current buffers, and notifies the Coordinator", async () => {
      const hold = await requestHold();
      // A venue edit between the request and the placement changes the buffers to store.
      await database
        .update(schema.venues)
        .set({ setupMinutes: 15, turnaroundMinutes: 10 })
        .where(eq(schema.venues.id, venueId));

      const placed = await place(hold.id);
      expect(placed).toMatchObject({
        status: "held",
        expiresAt: "2099-06-10 12:00:00",
        placedById: users.venueStaff.id,
        heldById: users.coordinator.id,
        setupMinutes: 15,
        turnaroundMinutes: 10,
      });
      expect(await ledger(hold.id)).toMatchObject([
        {
          venueId,
          eventId,
          startsAt: "2099-06-15 09:00:00",
          endsAt: "2099-06-15 12:00:00",
          setupMinutes: 15,
          turnaroundMinutes: 10,
          active: true,
        },
      ]);
      expect(await notices("venue_hold_placed")).toMatchObject([
        {
          recipientId: users.coordinator.id,
          eventRequestId: eventId,
          payload: {
            venueHoldId: hold.id,
            venueId,
            venueName: VENUE_NAME,
            expiresAt: "2099-06-10 12:00:00",
          },
        },
      ]);
    });

    it("notifies the current assignee, else the requester", async () => {
      const reassigned = await requestHold();
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.otherCoordinator.id })
        .where(eq(schema.eventRequests.id, eventId));
      await place(reassigned.id);

      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.coordinator.id })
        .where(eq(schema.eventRequests.id, eventId));
      const unassigned = await requestHold(users.coordinator, "2099-06-16");
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: null })
        .where(eq(schema.eventRequests.id, eventId));
      await decline(unassigned.id);

      expect((await notices("venue_hold_placed")).map(row => row.recipientId)).toEqual([
        users.otherCoordinator.id,
      ]);
      expect((await notices("venue_hold_declined")).map(row => row.recipientId)).toEqual([
        users.coordinator.id,
      ]);
    });

    it("refuses an expiry that is not in the future", async () => {
      const hold = await requestHold();
      await expect(place(hold.id, users.venueStaff, "2000-01-01T00:00")).rejects.toThrow(
        VENUE_HOLD_EXPIRY_PAST_MESSAGE
      );
      expect((await holdRow(hold.id)).status).toBe("requested");
    });
  });

  describe("refusing a placement (AC4)", () => {
    it("names the venue and period when the venue is no longer free", async () => {
      const hold = await requestHold();
      await requestAndPlaceHold(
        { venueId, eventId: otherEventId, ...window },
        session(users.otherCoordinator),
        database as never
      );

      await expect(place(hold.id)).rejects.toThrow(
        venueHoldConflictMessage({
          venueName: VENUE_NAME,
          startsAt: "2099-06-15 08:30:00",
          endsAt: "2099-06-15 12:45:00",
        })
      );
      expect((await holdRow(hold.id)).status).toBe("requested");
      expect(await ledger(hold.id)).toEqual([]);
      expect(
        (await notices("venue_hold_placed")).filter(row => row.eventRequestId === eventId)
      ).toEqual([]);
    });

    it("refuses a window that overlaps a pending request of the same event", async () => {
      // A requested hold holds no venue time, so the Coordinator can raise a booking request for
      // an overlapping window before placement. A placed hold must not overlap it.
      const hold = await requestHold();
      await handleCreateVenueRequest(
        { venueId, eventId, date: "2099-06-15", startTime: "11:00", endTime: "13:00" },
        session(users.coordinator),
        database as never
      );
      await expect(place(hold.id)).rejects.toThrow("overlaps this event's pending request");
      expect((await holdRow(hold.id)).status).toBe("requested");
      expect(await ledger(hold.id)).toEqual([]);
    });

    it("names the status when the event left the searchable statuses", async () => {
      const hold = await requestHold();
      await setEventStatus("confirmed");
      await expect(place(hold.id)).rejects.toThrow(venueRequestEventStatusMessage("confirmed"));
      expect((await holdRow(hold.id)).status).toBe("requested");
      expect(await ledger(hold.id)).toEqual([]);
    });

    it("names the cancelled status, which the queue page shows as a toast", async () => {
      const hold = await requestHold();
      await setEventStatus("cancelled");
      await expect(place(hold.id)).rejects.toThrow(venueRequestEventStatusMessage("cancelled"));
      expect(isLeftHoldQueueMessage(venueRequestEventStatusMessage("cancelled"))).toBe(true);
    });
  });

  describe("declining a hold request (AC5)", () => {
    it("stores the reason and the decliner, and notifies the Coordinator", async () => {
      const hold = await requestHold();
      const declined = await decline(hold.id, users.venueStaff, "  Exams that week  ");
      expect(declined).toMatchObject({
        status: "declined",
        declineReason: "Exams that week",
        declinedById: users.venueStaff.id,
        placedById: null,
      });
      expect(await ledger(hold.id)).toEqual([]);
      expect(await notices("venue_hold_declined")).toMatchObject([
        {
          recipientId: users.coordinator.id,
          payload: { venueHoldId: hold.id, venueId, reason: "Exams that week" },
        },
      ]);
    });

    it("refuses a blank reason", async () => {
      const hold = await requestHold();
      await expect(decline(hold.id, users.venueStaff, "   ")).rejects.toThrow(
        VENUE_HOLD_DECLINE_REASON_REQUIRED
      );
      expect((await holdRow(hold.id)).status).toBe("requested");
    });
  });

  describe("two Venue Staff acting on one request (AC6)", () => {
    it("refuses the second action after a placement or a decline", async () => {
      const placed = await requestHold();
      await place(placed.id);
      await expect(place(placed.id, users.otherVenueStaff)).rejects.toThrow(
        VENUE_HOLD_REQUEST_HANDLED_MESSAGE
      );
      await expect(decline(placed.id, users.otherVenueStaff)).rejects.toThrow(
        VENUE_HOLD_REQUEST_HANDLED_MESSAGE
      );

      // The placed hold occupies the first window, so request another day.
      const declined = await requestHold(users.coordinator, "2099-06-16");
      await decline(declined.id);
      await expect(place(declined.id, users.otherVenueStaff)).rejects.toThrow(
        VENUE_HOLD_REQUEST_HANDLED_MESSAGE
      );
      expect((await holdRow(declined.id)).status).toBe("declined");
    });

    it("lets exactly one of two simultaneous actions win", async () => {
      const hold = await requestHold();
      const results = await Promise.allSettled([
        place(hold.id),
        decline(hold.id, users.otherVenueStaff),
      ]);
      const refused = results.filter(result => result.status === "rejected");
      expect(refused).toHaveLength(1);
      expect(refused[0].reason).toMatchObject({
        message: VENUE_HOLD_REQUEST_HANDLED_MESSAGE,
      });
      const { status } = await holdRow(hold.id);
      expect(await ledger(hold.id)).toHaveLength(status === "held" ? 1 : 0);
    });
  });

  describe("withdrawing a hold request (PTR-151 AC3)", () => {
    it("closes the request, records the actor, and keeps it out of the queue", async () => {
      const hold = await requestHold();
      const withdrawn = await withdraw(hold.id);
      expect(withdrawn).toEqual({ id: hold.id, status: "released" });
      expect(await holdRow(hold.id)).toMatchObject({
        status: "released",
        releasedById: users.coordinator.id,
      });
      expect(await ledger(hold.id)).toEqual([]);
      expect((await handleListVenueHoldRequests(database)).map(row => row.id)).not.toContain(
        hold.id
      );
      await expect(place(hold.id)).rejects.toThrow(VENUE_HOLD_REQUEST_HANDLED_MESSAGE);
    });

    it("lets the current assignee or the requester withdraw, and refuses anyone else", async () => {
      const refused = await requestHold();
      await expect(withdraw(refused.id, users.otherCoordinator)).rejects.toThrow("Forbidden");
      // Raise the second request before the handover, while the original coordinator still
      // coordinates the event.
      const requesterHolds = await requestHold(users.coordinator, "2099-06-16");
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: users.otherCoordinator.id })
        .where(eq(schema.eventRequests.id, eventId));

      // The current assignee withdraws the first request.
      expect((await withdraw(refused.id, users.otherCoordinator)).status).toBe("released");
      // The requester keeps the withdrawal after the reassignment.
      expect((await withdraw(requesterHolds.id)).status).toBe("released");
    });

    it("refuses a placed or declined request", async () => {
      const placed = await requestHold();
      await place(placed.id);
      await expect(withdraw(placed.id)).rejects.toThrow(VENUE_HOLD_REQUEST_HANDLED_MESSAGE);

      const declined = await requestHold(users.coordinator, "2099-06-16");
      await decline(declined.id);
      await expect(withdraw(declined.id)).rejects.toThrow(VENUE_HOLD_REQUEST_HANDLED_MESSAGE);
    });
  });

  describe("showing a hold request (PTR-151 AC2)", () => {
    it("lists it on the calendar without occupying venue time", async () => {
      const hold = await requestHold();
      const calendar = await handleGetVenueAvailability(
        { venueId, startDate: window.date, endDate: window.date },
        users.coordinator.id,
        database as never
      );
      expect(calendar?.requestedHolds).toEqual([
        {
          id: hold.id,
          startsAt: "2099-06-15T09:00:00",
          endsAt: "2099-06-15T12:00:00",
          canWithdraw: true,
        },
      ]);
      expect(calendar?.occupied).toEqual([]);
      expect(calendar?.available).toEqual([
        { startsAt: "2099-06-15T08:00:00", endsAt: "2099-06-15T22:00:00" },
      ]);

      // Another Coordinator reads the request without the withdrawal action.
      const otherView = await handleGetVenueAvailability(
        { venueId, startDate: window.date, endDate: window.date },
        users.otherCoordinator.id,
        database as never
      );
      expect(otherView?.requestedHolds?.[0]).toMatchObject({ id: hold.id, canWithdraw: false });
    });

    it("lists it on the event's venue section for its Coordinator", async () => {
      const hold = await requestHold();
      const [projection] = await handleListEvents(
        { eventId },
        session(users.coordinator),
        database as never
      );
      expect(projection.event.holdRequests).toEqual([
        {
          id: hold.id,
          venueName: VENUE_NAME,
          startsAt: "2099-06-15T09:00:00",
          endsAt: "2099-06-15T12:00:00",
        },
      ]);
    });
  });
});
