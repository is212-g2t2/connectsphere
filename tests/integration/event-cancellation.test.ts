// Mirrors event-confirmation.test.ts: a local node-postgres drizzle instance, not the app's
// `#/db`, with notifications read back from the `notifications` table.
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { handleGetCoordinationRequest } from "#/features/coordination/assignments.server";
import {
  handleReleaseEquipment,
  handleReserveEquipment,
} from "#/features/equipment-requests/reservations.server";
import { handleRequestEventCancellation } from "#/features/event-requests/cancellation-requests.server";
import {
  handleGetEventRequest,
  handleListUnassignedEventRequests,
} from "#/features/event-requests/drafts.server";
import {
  EVENT_CANCELLATION_ALREADY_REQUESTED,
  EVENT_CANCELLATION_CLOSED,
} from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { handleCancelEvent, handleDeclineEventCancellation } from "#/features/events/cancel.server";
import {
  CANCELLED_EVENT_ACTIVITY_MESSAGE,
  NO_CANCELLATION_REQUEST_MESSAGE,
} from "#/features/events/cancellation";
import {
  handleAddVipRegistration,
  handleRegisterForEvent,
} from "#/features/events/register.server";
import {
  notificationHref,
  notificationSummary,
  parseNotificationPayload,
} from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import { handleReleaseVenueBooking } from "#/features/venue-requests/bookings.server";
import {
  handleConvertVenueHold,
  handleCreateVenueHold,
  handleReleaseVenueHold,
} from "#/features/venue-requests/holds.server";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
} from "#/features/venue-requests/requests.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const actor = (id: string, role: string, name = id): SessionUser => ({
  id,
  role,
  name,
  email: `${id}@x.test`,
});

const organiser = actor("cancellation-organiser", "event_organiser", "Cancel Organiser");
const otherOrganiser = actor("cancellation-other-organiser", "event_organiser");
const coordinator = actor("cancellation-coordinator", "event_coordinator", "Cancel Coordinator");
const otherCoordinator = actor("cancellation-other-coordinator", "event_coordinator");
const venueStaff = actor("cancellation-venue-staff", "venue_staff", "Cancel Venue Staff");
const technicalSupport = actor(
  "cancellation-tech-support",
  "technical_support_staff",
  "Cancel Tech Support"
);
const attendee = actor("cancellation-attendee", "attendee");
const vipAttendee = actor("cancellation-vip", "attendee");
const formerAttendee = actor("cancellation-former-attendee", "attendee");
const users = [
  organiser,
  otherOrganiser,
  coordinator,
  otherCoordinator,
  venueStaff,
  technicalSupport,
  attendee,
  vipAttendee,
  formerAttendee,
];

const VENUE_NAME = "Cancellation Test Hall";
const EQUIPMENT_TYPE = "Cancellation Test Projector";

const DECIDED = new Set<EventRequestStatus>(["approved", "rejected", "planning", "confirmed"]);

async function conflict(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConflictError);
  return (error as Error).message;
}

function parsed(notice: { kind: string; payload: unknown; eventRequestId: number }) {
  const result = parseNotificationPayload(notice.kind, notice.payload);
  if (!result) throw new Error(`${notice.kind} did not parse`);
  return { ...result, eventRequestId: notice.eventRequestId };
}

describe("cancelling an event (PTR-53, PTR-54)", () => {
  let pool: Pool;
  let database: Database;
  let venueId: number;
  let equipmentTypeId: number;
  // A distant year per booking, hold and reservation keeps the overlap constraints from tripping.
  let year = 2060;
  const created: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });

    await database
      .insert(schema.user)
      .values(
        users.map(user => ({
          id: user.id,
          name: user.name ?? user.id,
          email: user.email,
          emailVerified: true,
          role: user.role ?? undefined,
        }))
      )
      .onConflictDoNothing();
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: VENUE_NAME,
        location: "Level 5",
        maxCapacity: 100,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    venueId = venue.id;
    await database
      .delete(schema.equipmentTypes)
      .where(eq(schema.equipmentTypes.name, EQUIPMENT_TYPE));
    const [type] = await database
      .insert(schema.equipmentTypes)
      .values({ name: EQUIPMENT_TYPE, quantityHeld: 50 })
      .returning({ id: schema.equipmentTypes.id });
    equipmentTypeId = type.id;
  });

  afterEach(async () => {
    if (created.length === 0) return;
    // Lines, reservations, holds, registrations, requests and notifications cascade with the
    // event; the venue request keeps its venue, so it goes first.
    await database
      .delete(schema.venueRequests)
      .where(inArray(schema.venueRequests.eventId, created));
    await database.delete(schema.venueHolds).where(inArray(schema.venueHolds.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });

  afterAll(async () => {
    await database.delete(schema.venues).where(eq(schema.venues.name, VENUE_NAME));
    await database
      .delete(schema.equipmentTypes)
      .where(eq(schema.equipmentTypes.name, EQUIPMENT_TYPE));
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        users.map(user => user.id)
      )
    );
    await pool.end();
  });

  async function createEvent(
    status: EventRequestStatus = "confirmed",
    { assigned = true }: { assigned?: boolean } = {}
  ) {
    const decided = DECIDED.has(status) || status === "completed";
    const confirmed = status === "confirmed" || status === "completed";
    const completed = status === "completed";
    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status,
        submittedAt: status === "draft" ? null : new Date(),
        ...(assigned && status !== "draft"
          ? { assignedCoordinatorId: coordinator.id, assignedAt: new Date() }
          : {}),
        ...(decided
          ? {
              decisionReason: status === "rejected" ? "Not suitable" : null,
              decidedByCoordinatorId: coordinator.id,
              decidedByCoordinatorName: coordinator.name,
              decidedAt: new Date(),
            }
          : {}),
        ...(confirmed
          ? {
              confirmedById: coordinator.id,
              confirmedByName: coordinator.name,
              confirmedAt: new Date(),
            }
          : {}),
        ...(completed
          ? {
              completedById: coordinator.id,
              completedByName: coordinator.name,
              completedAt: new Date(),
            }
          : {}),
        ...(status === "cancelled"
          ? {
              cancelledById: coordinator.id,
              cancelledByName: coordinator.name,
              cancelledAt: new Date(),
            }
          : {}),
        eventName: `Cancellation test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [{ start: "2026-12-05T10:00", end: "2026-12-05T16:00" }],
        expectedAttendance: 10,
        eventType: "Conference",
        ...(status === "confirmed"
          ? {
              registrationEnabled: true,
              registrationCapacity: 40,
              registrationOpensAt: "2026-01-01T09:00",
              registrationClosesAt: "2099-01-01T09:00",
            }
          : {}),
      })
      .returning();
    created.push(row.id);
    return row;
  }

  function nextWindow() {
    year += 1;
    return { startsAt: `${year}-12-05 10:00:00`, endsAt: `${year}-12-05 16:00:00` };
  }

  /** The form input a Coordinator sends for a new hold or venue request, in a fresh year. */
  function periodInput(eventId: number) {
    year += 1;
    return { eventId, venueId, date: `${year}-12-05`, startTime: "10:00", endTime: "12:00" };
  }

  async function addBooking(
    eventId: number,
    status: "pending" | "approved" | "released" = "approved"
  ) {
    const id = crypto.randomUUID();
    await database.insert(schema.venueRequests).values({
      id,
      eventId,
      venueId,
      requestedById: coordinator.id,
      assignedStaffId: status === "pending" ? null : venueStaff.id,
      ...nextWindow(),
      status,
      ...(status === "released" ? { releaseReason: "Maintenance" } : {}),
    });
    return id;
  }

  async function addHold(eventId: number) {
    const id = crypto.randomUUID();
    await database
      .insert(schema.venueHolds)
      .values({ id, eventId, venueId, heldById: coordinator.id, ...nextWindow() });
    return id;
  }

  async function addReservedLine(eventId: number, quantity = 3) {
    const id = crypto.randomUUID();
    await database.insert(schema.equipmentRequests).values({
      id,
      eventId,
      equipmentTypeId,
      assignedStaffId: technicalSupport.id,
      item: EQUIPMENT_TYPE,
      quantity,
      arrangementStatus: "reserved",
    });
    await database.insert(schema.equipmentReservations).values({
      id: crypto.randomUUID(),
      equipmentRequestId: id,
      equipmentTypeId,
      quantity,
      ...nextWindow(),
    });
    return id;
  }

  const requestCancellation = (eventId: number, as: SessionUser = organiser) =>
    handleRequestEventCancellation({ id: eventId }, as, database as never);
  const cancel = (eventId: number, as: SessionUser = coordinator) =>
    handleCancelEvent({ id: eventId }, as, database as never);
  const decline = (eventId: number, reason: string, as: SessionUser = coordinator) =>
    handleDeclineEventCancellation({ id: eventId, reason }, as, database as never);

  async function cancelledEvent() {
    const event = await createEvent("confirmed");
    await requestCancellation(event.id);
    await cancel(event.id);
    return event;
  }

  const outstandingReleases = async (eventId: number) =>
    (await handleGetCoordinationRequest({ id: eventId }, coordinator, database as never))
      .outstandingReleases;

  const holdsFor = (eventId: number) =>
    database.select().from(schema.venueHolds).where(eq(schema.venueHolds.eventId, eventId));

  const eventRow = async (id: number) =>
    (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0];

  const requestsFor = (eventId: number) =>
    database
      .select()
      .from(schema.eventCancellationRequests)
      .where(eq(schema.eventCancellationRequests.eventRequestId, eventId));

  const notificationsFor = (
    eventId: number,
    kind: (typeof schema.notificationKind.enumValues)[number]
  ) =>
    database
      .select()
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.eventRequestId, eventId), eq(schema.notifications.kind, kind))
      )
      .orderBy(schema.notifications.recipientId);

  // ── PTR-53 ─────────────────────────────────────────────────────────────────────────────────
  describe("requesting cancellation (PTR-53)", () => {
    test("records the Organiser's request on their event (AC1)", async () => {
      const event = await createEvent("planning");

      const request = await requestCancellation(event.id);

      expect(request).toMatchObject({
        eventRequestId: event.id,
        organiserId: organiser.id,
        outcome: null,
        processedAt: null,
      });
      const detail = await handleGetEventRequest({ id: event.id }, organiser, database as never);
      expect(detail?.cancellationRequests).toEqual([
        expect.objectContaining({ id: request.id, outcome: null }),
      ]);
    });

    test("refuses another Organiser's event and an unknown id the same way (AC1)", async () => {
      const event = await createEvent("planning");

      await expect(requestCancellation(event.id, otherOrganiser)).rejects.toBeInstanceOf(
        AuthorizationError
      );
      await expect(requestCancellation(2_000_000_000)).rejects.toBeInstanceOf(AuthorizationError);
      expect(await requestsFor(event.id)).toEqual([]);
    });

    test.each([
      "submitted",
      "under_review",
      "awaiting_organiser",
      "approved",
      "rejected",
      "planning",
      "confirmed",
    ] satisfies EventRequestStatus[])("accepts a %s event (AC2)", async status => {
      const event = await createEvent(status);

      await expect(requestCancellation(event.id)).resolves.toMatchObject({ outcome: null });
    });

    test("applies no deadline: an event that has already started is accepted (AC2)", async () => {
      const event = await createEvent("confirmed");
      await database
        .update(schema.eventRequests)
        .set({ proposedDates: [{ start: "2020-01-01T09:00", end: "2099-01-01T09:00" }] })
        .where(eq(schema.eventRequests.id, event.id));

      await expect(requestCancellation(event.id)).resolves.toMatchObject({ outcome: null });
    });

    test.each(["draft", "completed", "cancelled"] satisfies EventRequestStatus[])(
      "refuses a %s event (AC2)",
      async status => {
        const event = await createEvent(status);

        expect(await conflict(requestCancellation(event.id))).toBe(EVENT_CANCELLATION_CLOSED);
        expect(await requestsFor(event.id)).toEqual([]);
      }
    );

    test("refuses a second request while one waits, and takes a new one once declined", async () => {
      const event = await createEvent("planning");
      await requestCancellation(event.id);

      expect(await conflict(requestCancellation(event.id))).toBe(
        EVENT_CANCELLATION_ALREADY_REQUESTED
      );

      await decline(event.id, "The venue is already paid for.");
      await expect(requestCancellation(event.id)).resolves.toMatchObject({ outcome: null });
      expect(await requestsFor(event.id)).toHaveLength(2);
    });

    test("records one request when the Organiser asks twice at once", async () => {
      const event = await createEvent("planning");

      const results = await Promise.allSettled([
        requestCancellation(event.id),
        requestCancellation(event.id),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(result => result.status === "rejected");
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      expect(((rejected as PromiseRejectedResult).reason as Error).message).toBe(
        EVENT_CANCELLATION_ALREADY_REQUESTED
      );
      expect(await requestsFor(event.id)).toHaveLength(1);
      expect(await notificationsFor(event.id, "event_cancellation_requested")).toHaveLength(1);
    });

    test("accepts a new request once the Coordinator has declined the last one", async () => {
      const event = await createEvent("planning");
      const first = await requestCancellation(event.id);
      await database
        .update(schema.eventCancellationRequests)
        .set({
          outcome: "declined",
          declineReason: "The deposit is paid.",
          processedById: coordinator.id,
          processedByName: coordinator.name,
          processedAt: new Date(),
        })
        .where(eq(schema.eventCancellationRequests.id, first.id));

      const second = await requestCancellation(event.id);

      const detail = await handleGetEventRequest({ id: event.id }, organiser, database as never);
      expect(detail?.cancellationRequests).toEqual([
        expect.objectContaining({ id: first.id, outcome: "declined" }),
        expect.objectContaining({ id: second.id, outcome: null }),
      ]);
    });

    test.each([
      { processedById: " ", processedByName: coordinator.name },
      { processedById: coordinator.id, processedByName: " " },
    ])("refuses a decided request with a blank processor (%o)", async processor => {
      const event = await createEvent("planning");
      const request = await requestCancellation(event.id);

      // Drizzle wraps the driver error, so the constraint name is on the cause, not the message.
      await expect(
        database
          .update(schema.eventCancellationRequests)
          .set({ outcome: "cancelled", processedAt: new Date(), ...processor })
          .where(eq(schema.eventCancellationRequests.id, request.id))
      ).rejects.toMatchObject({
        cause: { constraint: "event_cancellation_requests_outcome_complete" },
      });
    });

    test("shows the request on the assigned Coordinator's page", async () => {
      const event = await createEvent("planning");
      const request = await requestCancellation(event.id);

      const view = await handleGetCoordinationRequest(
        { id: event.id },
        coordinator,
        database as never
      );

      expect(view.cancellationRequests).toEqual([
        expect.objectContaining({ id: request.id, outcome: null }),
      ]);
    });

    test("notifies the assigned Coordinator and no one else (AC3)", async () => {
      const event = await createEvent("planning");

      await requestCancellation(event.id);

      const notices = await notificationsFor(event.id, "event_cancellation_requested");
      expect(notices).toHaveLength(1);
      const [notice] = notices;
      expect(notice.recipientId).toBe(coordinator.id);
      const notification = parsed(notice);
      expect(notificationSummary(notification)).toBe(
        `Event cancellation requested: ${event.eventName}`
      );
      expect(notificationHref(notification)).toBe(`/coordination/${event.id}`);
      expect(renderNotificationEmail(notification).subject).toBe(
        `Event cancellation requested: ${event.eventName}`
      );
    });

    test("leaves an unassigned event in the unassigned list, with no one to notify (AC3)", async () => {
      const event = await createEvent("submitted", { assigned: false });

      await requestCancellation(event.id);

      expect(await notificationsFor(event.id, "event_cancellation_requested")).toEqual([]);
      const unassigned = await handleListUnassignedEventRequests(database as never);
      expect(unassigned.map(row => row.id)).toContain(event.id);
    });

    test("leaves the event's status unchanged (AC4)", async () => {
      const event = await createEvent("confirmed");

      await requestCancellation(event.id);

      expect((await eventRow(event.id)).status).toBe("confirmed");
    });
  });

  // ── PTR-54 ─────────────────────────────────────────────────────────────────────────────────
  describe("processing a cancellation request (PTR-54)", () => {
    test("moves the event to cancelled and records who and when (AC1)", async () => {
      const event = await createEvent("confirmed");
      await requestCancellation(event.id);
      const before = new Date();

      await cancel(event.id);

      const row = await eventRow(event.id);
      expect(row).toMatchObject({
        status: "cancelled",
        cancelledById: coordinator.id,
        cancelledByName: coordinator.name,
      });
      expect(row.cancelledAt?.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      // The confirmation and the decision it followed stay on the record.
      expect(row.confirmedById).toBe(coordinator.id);
      expect(row.decidedByCoordinatorId).toBe(coordinator.id);
    });

    test("cancels an event before any decision was recorded", async () => {
      const event = await createEvent("under_review");
      await requestCancellation(event.id);

      await cancel(event.id);

      expect((await eventRow(event.id)).status).toBe("cancelled");
    });

    test("refuses anyone but the assigned Coordinator, and changes nothing", async () => {
      const event = await createEvent("planning");
      await requestCancellation(event.id);

      await expect(cancel(event.id, otherCoordinator)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(decline(event.id, "No", otherCoordinator)).rejects.toBeInstanceOf(
        AuthorizationError
      );
      expect((await eventRow(event.id)).status).toBe("planning");
    });

    test("refuses to cancel or decline without a waiting request (AC1)", async () => {
      const event = await createEvent("planning");

      expect(await conflict(cancel(event.id))).toBe(NO_CANCELLATION_REQUEST_MESSAGE);
      expect(await conflict(decline(event.id, "No"))).toBe(NO_CANCELLATION_REQUEST_MESSAGE);
      expect((await eventRow(event.id)).status).toBe("planning");
    });

    test("refuses to cancel an event completed after the request was raised", async () => {
      const event = await createEvent("confirmed");
      await requestCancellation(event.id);
      // Completion records who and when (PTR-25 AC3).
      await database
        .update(schema.eventRequests)
        .set({
          status: "completed",
          completedById: coordinator.id,
          completedByName: coordinator.name,
          completedAt: new Date(),
        })
        .where(eq(schema.eventRequests.id, event.id));

      expect(await conflict(cancel(event.id))).toBe(EVENT_CANCELLATION_CLOSED);
    });

    test("lists what the event still holds as outstanding releases (AC2)", async () => {
      const event = await createEvent("confirmed");
      const bookingId = await addBooking(event.id);
      await addBooking(event.id, "released");
      await addBooking(event.id, "pending");
      const holdId = await addHold(event.id);
      const lineId = await addReservedLine(event.id, 4);
      await requestCancellation(event.id);

      await cancel(event.id);

      expect(await outstandingReleases(event.id)).toEqual({
        venueBookings: [
          expect.objectContaining({
            id: bookingId,
            venueName: VENUE_NAME,
            startsAt: expect.any(String),
          }),
        ],
        venueHolds: [expect.objectContaining({ id: holdId, venueId, venueName: VENUE_NAME })],
        equipmentReservations: [{ id: lineId, item: EQUIPMENT_TYPE, quantity: 4 }],
      });
    });

    test("stops listing each item once the staff concerned release it (AC2, AC6)", async () => {
      const event = await createEvent("confirmed");
      const bookingId = await addBooking(event.id);
      const holdId = await addHold(event.id);
      const lineId = await addReservedLine(event.id, 4);
      await requestCancellation(event.id);
      await cancel(event.id);

      await handleReleaseVenueBooking(
        { id: bookingId, reason: "Event cancelled" },
        venueStaff,
        database as never
      );
      expect((await outstandingReleases(event.id))?.venueBookings).toEqual([]);

      await handleReleaseVenueHold({ id: holdId }, coordinator, database as never);
      expect((await outstandingReleases(event.id))?.venueHolds).toEqual([]);

      // A partial release keeps the line listed with what it still holds; a full one removes it.
      await handleReleaseEquipment(
        { equipmentRequestId: lineId, quantity: 1 },
        technicalSupport,
        database as never
      );
      expect((await outstandingReleases(event.id))?.equipmentReservations).toEqual([
        { id: lineId, item: EQUIPMENT_TYPE, quantity: 1 },
      ]);
      await handleReleaseEquipment(
        { equipmentRequestId: lineId, quantity: 0 },
        technicalSupport,
        database as never
      );
      expect(await outstandingReleases(event.id)).toEqual({
        venueBookings: [],
        venueHolds: [],
        equipmentReservations: [],
      });
    });

    test("shows no outstanding releases while the event is not cancelled", async () => {
      const event = await createEvent("confirmed");
      await addBooking(event.id);

      expect(await outstandingReleases(event.id)).toBeNull();
    });

    test("notifies the Venue Staff and Technical Support Staff holding arrangements (AC3)", async () => {
      const event = await createEvent("confirmed");
      await addBooking(event.id);
      await addReservedLine(event.id);
      await requestCancellation(event.id);

      await cancel(event.id);

      const notices = await notificationsFor(event.id, "event_cancelled");
      const venueNotice = notices.find(notice => notice.recipientId === venueStaff.id);
      const techNotice = notices.find(notice => notice.recipientId === technicalSupport.id);
      if (!venueNotice || !techNotice) throw new Error("staff were not notified");

      // Venue Staff are never shown the event's name (PTR-8), so their notice names the booking.
      expect(venueNotice.payload).toMatchObject({ audience: "venue_staff", venueName: VENUE_NAME });
      expect(venueNotice.payload).not.toHaveProperty("eventName");
      expect(notificationSummary(parsed(venueNotice))).toBe(
        `Event cancelled: release the booking at ${VENUE_NAME}`
      );
      expect(notificationHref(parsed(venueNotice))).toBe("/venue-bookings");

      expect(techNotice.payload).toEqual({
        audience: "technical_support",
        eventName: event.eventName,
      });
      expect(notificationHref(parsed(techNotice))).toBe(`/equipment-requests/${event.id}`);
      expect(renderNotificationEmail(parsed(techNotice)).subject).toBe(
        `Event cancelled: ${event.eventName}`
      );
    });

    test("notifies every registered Attendee, VIPs included, and no one withdrawn (AC4)", async () => {
      const event = await createEvent("confirmed");
      await database.insert(schema.eventRegistrations).values([
        { eventId: event.id, attendeeId: attendee.id },
        { eventId: event.id, attendeeId: vipAttendee.id, vip: true },
        { eventId: event.id, attendeeId: formerAttendee.id, status: "withdrawn" },
      ]);
      await requestCancellation(event.id);

      await cancel(event.id);

      const notices = (await notificationsFor(event.id, "event_cancelled")).filter(
        notice => (notice.payload as { audience: string }).audience === "attendee"
      );
      expect(notices.map(notice => notice.recipientId).toSorted()).toEqual(
        [attendee.id, vipAttendee.id].toSorted()
      );
      expect(notificationHref(parsed(notices[0]))).toBe(`/events/${event.id}`);
    });

    test("leaves the booking, the hold and the reservations held for manual release (AC6)", async () => {
      const event = await createEvent("confirmed");
      const bookingId = await addBooking(event.id);
      const holdId = await addHold(event.id);
      const lineId = await addReservedLine(event.id);
      await requestCancellation(event.id);

      await cancel(event.id);

      const [booking] = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, bookingId));
      const [hold] = await database
        .select()
        .from(schema.venueHolds)
        .where(eq(schema.venueHolds.id, holdId));
      const reservations = await database
        .select()
        .from(schema.equipmentReservations)
        .where(eq(schema.equipmentReservations.equipmentRequestId, lineId));
      expect(booking.status).toBe("approved");
      expect(hold.status).toBe("held");
      expect(reservations).toHaveLength(1);
    });

    test("notifies the Organiser and keeps the request with its outcome on the record (AC7)", async () => {
      const event = await createEvent("planning");
      await requestCancellation(event.id);

      await cancel(event.id);

      const notices = (await notificationsFor(event.id, "event_cancelled")).filter(
        notice => notice.recipientId === organiser.id
      );
      expect(notices).toHaveLength(1);
      expect(notices[0].payload).toEqual({ audience: "organiser", eventName: event.eventName });
      expect(notificationHref(parsed(notices[0]))).toBe(`/event-requests/${event.id}`);

      const detail = await handleGetEventRequest({ id: event.id }, organiser, database as never);
      expect(detail?.cancellationRequests).toEqual([
        expect.objectContaining({ outcome: "cancelled", processedByName: coordinator.name }),
      ]);
    });

    test("declines with a recorded reason, notifies the Organiser and keeps the event (AC8)", async () => {
      const event = await createEvent("confirmed");
      await requestCancellation(event.id);

      await decline(event.id, "  The venue deposit is non-refundable.  ");

      expect((await eventRow(event.id)).status).toBe("confirmed");
      const [request] = await requestsFor(event.id);
      expect(request).toMatchObject({
        outcome: "declined",
        declineReason: "The venue deposit is non-refundable.",
        processedById: coordinator.id,
        processedByName: coordinator.name,
      });
      const [notice] = await notificationsFor(event.id, "event_cancellation_declined");
      expect(notice.recipientId).toBe(organiser.id);
      const notification = parsed(notice);
      expect(notificationSummary(notification)).toBe(
        `Cancellation request declined: ${event.eventName}`
      );
      expect(notificationHref(notification)).toBe(`/event-requests/${event.id}`);
      expect(renderNotificationEmail(notification).subject).toBe(
        `Cancellation request declined: ${event.eventName}`
      );

      const detail = await handleGetEventRequest({ id: event.id }, organiser, database as never);
      expect(detail?.cancellationRequests).toEqual([
        expect.objectContaining({
          outcome: "declined",
          declineReason: "The venue deposit is non-refundable.",
        }),
      ]);
    });

    test("requires a reason to decline (AC8)", async () => {
      const event = await createEvent("planning");
      await requestCancellation(event.id);

      await expect(decline(event.id, "   ")).rejects.toThrow("Enter a reason for declining");
      const [request] = await requestsFor(event.id);
      expect(request.outcome).toBeNull();
    });
  });

  // ── PTR-54 AC5, AC9 ────────────────────────────────────────────────────────────────────────
  describe("a cancelled event takes no new arrangements (PTR-54 AC5, AC9)", () => {
    test("refuses to approve a venue request into a new booking", async () => {
      const event = await cancelledEvent();
      const requestId = await addBooking(event.id, "pending");

      expect(
        await conflict(handleApproveVenueRequest({ id: requestId }, venueStaff, database as never))
      ).toBe(CANCELLED_EVENT_ACTIVITY_MESSAGE);
      const [row] = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.id, requestId));
      expect(row.status).toBe("pending");
    });

    test("refuses a new equipment reservation", async () => {
      const event = await createEvent("planning");
      await addBooking(event.id);
      const lineId = crypto.randomUUID();
      await database.insert(schema.equipmentRequests).values({
        id: lineId,
        eventId: event.id,
        equipmentTypeId,
        assignedStaffId: technicalSupport.id,
        item: EQUIPMENT_TYPE,
        quantity: 2,
      });
      await database
        .update(schema.eventRequests)
        .set({ equipmentSubmittedAt: new Date() })
        .where(eq(schema.eventRequests.id, event.id));
      await requestCancellation(event.id);
      await cancel(event.id);

      expect(
        await conflict(
          handleReserveEquipment(
            { equipmentRequestId: lineId, quantity: 2 },
            technicalSupport,
            database as never
          )
        )
      ).toBe(CANCELLED_EVENT_ACTIVITY_MESSAGE);
    });

    test("refuses a new tentative hold", async () => {
      const event = await cancelledEvent();

      expect(
        await conflict(handleCreateVenueHold(periodInput(event.id), coordinator, database as never))
      ).toBe(CANCELLED_EVENT_ACTIVITY_MESSAGE);
      expect(await holdsFor(event.id)).toEqual([]);
    });

    test("refuses a new venue request", async () => {
      const event = await cancelledEvent();

      expect(
        await conflict(
          handleCreateVenueRequest(periodInput(event.id), coordinator, database as never)
        )
      ).toBe(CANCELLED_EVENT_ACTIVITY_MESSAGE);
      expect(
        await database
          .select()
          .from(schema.venueRequests)
          .where(eq(schema.venueRequests.eventId, event.id))
      ).toEqual([]);
    });

    test("refuses to convert a hold into a venue request, and leaves the hold held", async () => {
      const event = await createEvent("submitted");
      const holdId = await addHold(event.id);
      await requestCancellation(event.id);
      await cancel(event.id);

      expect(
        await conflict(handleConvertVenueHold({ id: holdId }, coordinator, database as never))
      ).toBe(CANCELLED_EVENT_ACTIVITY_MESSAGE);
      expect((await holdsFor(event.id)).map(hold => hold.status)).toEqual(["held"]);
    });

    test("makes a new hold wait for a cancellation in progress, then refuses it", async () => {
      const event = await createEvent("submitted");
      // A second connection plays the cancellation: it locks the event row as `handleCancelEvent`
      // does and moves the event to cancelled, uncommitted. A hold that reads the event without a
      // conflicting lock sees `submitted` and lands on the cancelled event.
      const client = await pool.connect();
      let holding: Promise<unknown> | undefined;
      try {
        await client.query("begin");
        await client.query("select id from event_requests where id = $1 for update", [event.id]);
        await client.query(
          "update event_requests set status = 'cancelled', cancelled_by_id = $2, cancelled_by_name = $3, cancelled_at = now() where id = $1",
          [event.id, coordinator.id, coordinator.name]
        );
        const { rows: clientRows } = await client.query<{ pid: number }>(
          "select pg_backend_pid() as pid"
        );

        holding = handleCreateVenueHold(
          periodInput(event.id),
          coordinator,
          database as never
        ).catch((caught: unknown) => caught);
        // Commit the cancellation only once it blocks the hold, so the hold must read it.
        await vi.waitFor(
          async () => {
            const { rows } = await pool.query<{ waiting: number }>(
              "select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and $1::int = any(pg_blocking_pids(pid))",
              [clientRows[0].pid]
            );
            expect(rows[0].waiting).toBeGreaterThan(0);
          },
          { timeout: 3_000, interval: 20 }
        );
        await client.query("commit");
      } finally {
        await client.query("rollback").catch(() => {});
        client.release();
      }

      const outcome = await holding;
      expect(outcome).toBeInstanceOf(ConflictError);
      expect((outcome as Error).message).toBe(CANCELLED_EVENT_ACTIVITY_MESSAGE);
      expect(await holdsFor(event.id)).toEqual([]);
    });

    test("refuses an Attendee's registration and a VIP registration (AC5)", async () => {
      const event = await cancelledEvent();

      await expect(
        handleRegisterForEvent({ id: event.id }, attendee, database as never)
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        handleAddVipRegistration(
          { id: event.id, attendeeId: vipAttendee.id },
          coordinator,
          database as never
        )
      ).rejects.toBeInstanceOf(ConflictError);
      expect(
        await database
          .select()
          .from(schema.eventRegistrations)
          .where(eq(schema.eventRegistrations.eventId, event.id))
      ).toEqual([]);
    });
  });
});
