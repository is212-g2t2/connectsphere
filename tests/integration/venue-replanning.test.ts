// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleListAssignedEventRequests } from "#/features/coordination/assignments.server";
import { handleConfirmEvent } from "#/features/events/confirm.server";
import { VENUE_BOOKING_SUSPENDED_MESSAGE } from "#/features/events/confirmation";
import { handleListEvents } from "#/features/events/records.server";
import { handleRegisterForEvent } from "#/features/events/register.server";
import { handleUpdateEventInformation } from "#/features/events/update.server";
import { requestAndPlaceHold } from "./hold-request";
import {
  handleApproveVenueRequest,
  handleCreateVenueRequest,
  handleReleaseBlockedVenueBooking,
} from "#/features/venue-requests/requests.server";
import { VENUE_BOOKING_NOT_BLOCKED_MESSAGE } from "#/features/venue-requests/schema";
import { loadBlockedArrangements } from "#/features/venues/blocked-arrangements.server";
import { handleLiftVenueBlock, handleRecordVenueBlock } from "#/features/venues/blocks.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

/**
 * PTR-137: a venue block takes a confirmed event back to planning, flags its suspended
 * arrangements for the Coordinator, and the Coordinator re-plans. Each test runs against the real
 * database with its own venues and events.
 */

const users = {
  organiser: {
    id: "ptr-137-organiser",
    name: "PTR-137 Organiser",
    email: "ptr-137-organiser@example.invalid",
    emailVerified: true,
    role: "event_organiser",
  },
  coordinator: {
    id: "ptr-137-coordinator",
    name: "PTR-137 Coordinator",
    email: "ptr-137-coordinator@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  otherCoordinator: {
    id: "ptr-137-coordinator-b",
    name: "PTR-137 Coordinator B",
    email: "ptr-137-coordinator-b@example.invalid",
    emailVerified: true,
    role: "event_coordinator",
  },
  venueStaff: {
    id: "ptr-137-staff",
    name: "PTR-137 Staff",
    email: "ptr-137-staff@example.invalid",
    emailVerified: true,
    role: "venue_staff",
  },
  attendee: {
    id: "ptr-137-attendee",
    name: "PTR-137 Attendee",
    email: "ptr-137-attendee@example.invalid",
    emailVerified: true,
    role: "attendee",
  },
} satisfies Record<string, typeof schema.user.$inferInsert>;

const HALL = "PTR-137 Replan Hall";
const ANNEX = "PTR-137 Replan Annex";
const DATE = "2027-10-20";

function session(user: (typeof users)[keyof typeof users]): SessionUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const coordinator = session(users.coordinator);
const otherCoordinator = session(users.otherCoordinator);
const staff = session(users.venueStaff);
const attendee = session(users.attendee);

describe("re-planning an event whose venue becomes unavailable (PTR-137)", () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let hallId: number;
  let annexId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await database.insert(schema.user).values(Object.values(users)).onConflictDoNothing();
  });

  async function cleanUp() {
    await database
      .delete(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, users.organiser.id));
    await database.delete(schema.venues).where(inArray(schema.venues.name, [HALL, ANNEX]));
  }

  afterAll(async () => {
    await cleanUp();
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        Object.values(users).map(user => user.id)
      )
    );
    await pool.end();
  });

  beforeEach(async () => {
    await cleanUp();
    const venues = await database
      .insert(schema.venues)
      .values(
        [HALL, ANNEX].map(name => ({
          name,
          location: "PTR-137 Wing",
          maxCapacity: 100,
          operatingHours: DEFAULT_OPERATING_HOURS,
        }))
      )
      .returning({ id: schema.venues.id });
    [hallId, annexId] = venues.map(venue => venue.id);
  });

  type Status = (typeof schema.eventRequestStatus.enumValues)[number];

  /** An event at the given stage with the stamps its CHECK constraints need. */
  async function createEvent(
    status: Status,
    extra: Partial<typeof schema.eventRequests.$inferInsert> = {}
  ) {
    const decided = !["submitted", "under_review", "awaiting_organiser"].includes(status);
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: users.organiser.id,
        eventName: `PTR-137 ${status} event`,
        purpose: "Re-plan",
        proposedDates: [{ start: `${DATE}T10:00`, end: `${DATE}T12:00` }],
        expectedAttendance: 40,
        status,
        submittedAt: new Date(),
        assignedCoordinatorId: users.coordinator.id,
        assignedAt: new Date(),
        ...(decided
          ? {
              decidedByCoordinatorId: users.coordinator.id,
              decidedByCoordinatorName: users.coordinator.name,
              decidedAt: new Date(),
            }
          : {}),
        ...(status === "confirmed"
          ? {
              confirmedById: users.coordinator.id,
              confirmedByName: users.coordinator.name,
              confirmedAt: new Date("2027-01-01T00:00:00Z"),
            }
          : {}),
        ...extra,
      })
      .returning();
    return event;
  }

  /** Raise and approve a booking at `venueId` for the event. The event must accept requests. */
  async function book(eventId: number, startTime: string, endTime: string, venueId = hallId) {
    const request = await handleCreateVenueRequest(
      { eventId, venueId, date: DATE, startTime, endTime },
      coordinator,
      database as never
    );
    await handleApproveVenueRequest({ id: request.id }, staff, database as never);
    return request.id;
  }

  /**
   * A confirmed event with an approved booking at the hall. Requests only open before approval,
   * so the booking is raised on a submitted event, which then moves on with its stamps.
   */
  async function confirmedEventWithBooking(
    extra: Partial<typeof schema.eventRequests.$inferInsert> = {}
  ) {
    const event = await createEvent("submitted");
    const bookingId = await book(event.id, "10:00", "12:00");
    await database
      .update(schema.eventRequests)
      .set({
        status: "confirmed",
        decidedByCoordinatorId: users.coordinator.id,
        decidedByCoordinatorName: users.coordinator.name,
        decidedAt: new Date(),
        confirmedById: users.coordinator.id,
        confirmedByName: users.coordinator.name,
        confirmedAt: new Date("2027-01-01T00:00:00Z"),
        ...extra,
      })
      .where(eq(schema.eventRequests.id, event.id));
    return { eventId: event.id, bookingId };
  }

  async function recordBlock(
    startTime: string,
    endTime?: string,
    venueId = hallId,
    reason = "PTR-137 flooding"
  ) {
    return handleRecordVenueBlock(
      endTime === undefined
        ? { venueId, date: DATE, startTime, reason }
        : { venueId, date: DATE, startTime, endDate: DATE, endTime, reason },
      staff,
      database as never
    );
  }

  const liftBlock = (id: number) => handleLiftVenueBlock({ id }, staff, database as never);

  const eventRow = async (id: number) =>
    (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0];

  const bookingRow = async (id: string) =>
    (await database.select().from(schema.venueRequests).where(eq(schema.venueRequests.id, id)))[0];

  const ledgerForRequest = (id: string) =>
    database
      .select()
      .from(schema.venueOccupancy)
      .where(eq(schema.venueOccupancy.venueRequestId, id));

  const notices = (eventId: number, kind: (typeof schema.notificationKind.enumValues)[number]) =>
    database
      .select()
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.eventRequestId, eventId), eq(schema.notifications.kind, kind))
      )
      .orderBy(schema.notifications.id);

  const coordinatorView = async (eventId: number, as: SessionUser = coordinator) =>
    (await handleListEvents({ eventId }, as, database as never))[0];

  const release = (id: string, as: SessionUser = coordinator) =>
    handleReleaseBlockedVenueBooking({ id }, as, database as never);

  it("takes a confirmed event back to planning when a block covers its booking, keeps its record, and tells the Coordinator (AC1, AC2)", async () => {
    const { eventId, bookingId } = await confirmedEventWithBooking({
      registrationEnabled: true,
      registrationCapacity: 50,
      registrationOpensAt: "2027-01-02T09:00",
      registrationClosesAt: "2027-10-19T17:00",
    });
    const before = await eventRow(eventId);

    const block = await recordBlock("09:00", "13:00");

    const after = await eventRow(eventId);
    expect(after.status).toBe("planning");
    expect(after).toMatchObject({ confirmedById: null, confirmedByName: null, confirmedAt: null });
    // The decision, the information and the registration terms are untouched.
    expect(after).toMatchObject({
      decidedByCoordinatorId: before.decidedByCoordinatorId,
      eventName: before.eventName,
      proposedDates: before.proposedDates,
      registrationEnabled: true,
      registrationCapacity: 50,
    });
    expect((await bookingRow(bookingId)).status).toBe("approved");

    const [notice] = await notices(eventId, "venue_block_changed");
    expect(notice).toMatchObject({ recipientId: users.coordinator.id });
    expect(notice.payload).toMatchObject({
      action: "blocked",
      reason: "PTR-137 flooding",
      revertedToPlanning: true,
    });

    // The suspended booking still reads approved, yet the event cannot be confirmed on it.
    await expect(
      handleConfirmEvent({ id: eventId }, coordinator, database as never)
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(VENUE_BOOKING_SUSPENDED_MESSAGE),
    });

    // The lift restores the booking; the event stays in planning and the notice says so.
    await liftBlock(block.id);
    expect((await eventRow(eventId)).status).toBe("planning");
    const [, lifted] = await notices(eventId, "venue_block_changed");
    expect(lifted.payload).toMatchObject({ action: "lifted", restoredToPlanning: true });
    const confirmed = await handleConfirmEvent({ id: eventId }, coordinator, database as never);
    expect(confirmed.status).toBe("confirmed");
  });

  it("leaves a confirmed event alone when a block covers only its hold", async () => {
    const event = await createEvent("submitted");
    await requestAndPlaceHold(
      { eventId: event.id, venueId: hallId, date: DATE, startTime: "14:00", endTime: "16:00" },
      coordinator,
      database as never
    );
    await book(event.id, "10:00", "12:00", annexId);
    await database
      .update(schema.eventRequests)
      .set({
        status: "confirmed",
        decidedByCoordinatorId: users.coordinator.id,
        decidedByCoordinatorName: users.coordinator.name,
        decidedAt: new Date(),
        confirmedById: users.coordinator.id,
        confirmedByName: users.coordinator.name,
        confirmedAt: new Date("2027-01-01T00:00:00Z"),
      })
      .where(eq(schema.eventRequests.id, event.id));

    const block = await recordBlock("13:00", "17:00");

    expect((await eventRow(event.id)).status).toBe("confirmed");
    const [notice] = await notices(event.id, "venue_block_changed");
    expect(notice.payload).not.toHaveProperty("revertedToPlanning");
    const blocked = (await loadBlockedArrangements(database, [event.id])).get(event.id) ?? [];
    expect(blocked.map(item => item.kind)).toEqual(["hold"]);

    // The lift restores the hold, yet the event never reverted: the notice stays plain.
    await liftBlock(block.id);
    const liftNotice = (await notices(event.id, "venue_block_changed"))[1];
    expect(liftNotice.payload).not.toHaveProperty("restoredToPlanning");

    // The intact booking still carries a confirmation: the suspended hold is no blocker.
    await database
      .update(schema.eventRequests)
      .set({ status: "planning", confirmedById: null, confirmedByName: null, confirmedAt: null })
      .where(eq(schema.eventRequests.id, event.id));
    const confirmed = await handleConfirmEvent({ id: event.id }, coordinator, database as never);
    expect(confirmed.status).toBe("confirmed");
  });

  it("leaves an approved or planning event's status alone and raises the notice without the revert flag", async () => {
    const event = await createEvent("submitted");
    const bookingId = await book(event.id, "10:00", "12:00");
    await database
      .update(schema.eventRequests)
      .set({
        status: "approved",
        decidedByCoordinatorId: users.coordinator.id,
        decidedByCoordinatorName: users.coordinator.name,
        decidedAt: new Date(),
      })
      .where(eq(schema.eventRequests.id, event.id));

    await recordBlock("09:00", "13:00");

    expect((await eventRow(event.id)).status).toBe("approved");
    expect((await bookingRow(bookingId)).status).toBe("approved");
    const [notice] = await notices(event.id, "venue_block_changed");
    expect(notice.payload).not.toHaveProperty("revertedToPlanning");
  });

  it("flags the suspended booking with the block's reason for the Coordinator only, on the event and on the list (AC1)", async () => {
    const { eventId, bookingId } = await confirmedEventWithBooking();
    const block = await recordBlock("09:00", "13:00");

    const blocked = await loadBlockedArrangements(database, [eventId]);
    expect(blocked.get(eventId)).toEqual([
      {
        kind: "booking",
        id: bookingId,
        venueName: HALL,
        startsAt: `${DATE} 10:00:00`,
        endsAt: `${DATE} 12:00:00`,
        blocks: [
          {
            reason: "PTR-137 flooding",
            startsAt: `${DATE} 09:00:00`,
            endsAt: `${DATE} 13:00:00`,
          },
        ],
      },
    ]);

    const view = await coordinatorView(eventId);
    expect(view.access).toBe("coordinator");
    expect(view.event.blockedArrangements).toHaveLength(1);
    const organiserView = (
      await handleListEvents({ eventId }, session(users.organiser), database as never)
    )[0];
    expect(organiserView.event).not.toHaveProperty("blockedArrangements");

    const list = await handleListAssignedEventRequests(coordinator, database as never);
    expect(list.find(row => row.id === eventId)?.venueBlocked).toBe(true);

    // A cancelled event keeps its ledger rows, yet is neither flagged nor listed as blocked.
    await database
      .update(schema.eventRequests)
      .set({
        status: "cancelled",
        cancelledById: users.coordinator.id,
        cancelledByName: users.coordinator.name,
        cancelledAt: new Date(),
      })
      .where(eq(schema.eventRequests.id, eventId));
    expect((await loadBlockedArrangements(database, [eventId])).get(eventId)).toBeUndefined();
    expect(
      (await handleListAssignedEventRequests(coordinator, database as never)).find(
        row => row.id === eventId
      )?.venueBlocked
    ).toBe(false);
    await database
      .update(schema.eventRequests)
      .set({ status: "planning", cancelledById: null, cancelledByName: null, cancelledAt: null })
      .where(eq(schema.eventRequests.id, eventId));

    // Lifting restores the booking and clears the flag; the event stays in planning (AC4).
    await liftBlock(block.id);
    expect((await loadBlockedArrangements(database, [eventId])).get(eventId)).toBeUndefined();
    expect(
      (await handleListAssignedEventRequests(coordinator, database as never)).find(
        row => row.id === eventId
      )?.venueBlocked
    ).toBe(false);
    expect((await bookingRow(bookingId)).status).toBe("approved");
    expect(await ledgerForRequest(bookingId)).toEqual([expect.objectContaining({ active: true })]);
    expect((await eventRow(eventId)).status).toBe("planning");
  });

  it("names every block that suspends one booking, on the panel and in the release reason (AC1, AC4)", async () => {
    const { eventId, bookingId } = await confirmedEventWithBooking();
    // Two adjacent live blocks, each suspending a different piece of the 10:00–12:00 booking.
    await recordBlock("09:00", "11:00", hallId, "PTR-137 morning works");
    await recordBlock("11:00", "13:00", hallId, "PTR-137 afternoon works");
    expect((await eventRow(eventId)).status).toBe("planning");

    const blocked = (await loadBlockedArrangements(database, [eventId])).get(eventId) ?? [];
    expect(blocked).toHaveLength(1);
    expect(blocked[0].blocks.map(block => block.reason)).toEqual([
      "PTR-137 morning works",
      "PTR-137 afternoon works",
    ]);

    const released = await release(bookingId);
    expect(released).toMatchObject({
      status: "released",
      releaseReason: `Released by the Coordinator while ${HALL} was blocked: PTR-137 morning works; PTR-137 afternoon works`,
    });
  });

  it("flags a suspended hold too, and a booking a block only partly covers", async () => {
    const event = await createEvent("submitted");
    await requestAndPlaceHold(
      { eventId: event.id, venueId: hallId, date: DATE, startTime: "14:00", endTime: "16:00" },
      coordinator,
      database as never
    );
    const bookingId = await book(event.id, "10:00", "12:00");
    await database
      .update(schema.eventRequests)
      .set({
        status: "confirmed",
        decidedByCoordinatorId: users.coordinator.id,
        decidedByCoordinatorName: users.coordinator.name,
        decidedAt: new Date(),
        confirmedById: users.coordinator.id,
        confirmedByName: users.coordinator.name,
        confirmedAt: new Date("2027-01-01T00:00:00Z"),
      })
      .where(eq(schema.eventRequests.id, event.id));

    await recordBlock("11:00", "15:00");

    const blocked = (await loadBlockedArrangements(database, [event.id])).get(event.id) ?? [];
    expect(blocked.map(item => [item.kind, item.id])).toEqual([
      ["booking", bookingId],
      ["hold", expect.any(String)],
    ]);
    // The block covers only part of the booking, yet that piece is suspended: the event reverts.
    expect((await eventRow(event.id)).status).toBe("planning");
  });

  it("lets the Coordinator release a suspended booking in favour of a replacement, tells the Venue Staff, and the lift leaves the replacement standing (AC3, AC4)", async () => {
    const { eventId, bookingId } = await confirmedEventWithBooking();
    const block = await recordBlock("09:00", "13:00");

    // AC3: the replacement goes through the built request path and its own approval.
    const replacementId = await book(eventId, "10:00", "12:00", annexId);
    const released = await release(bookingId);

    expect(released).toMatchObject({
      status: "released",
      releaseReason: `Released by the Coordinator while ${HALL} was blocked: PTR-137 flooding`,
      lastChangedByStaffId: users.coordinator.id,
      lastChangedByStaffName: users.coordinator.name,
    });
    expect(await ledgerForRequest(bookingId)).toEqual([]);
    const [staffNotice] = await notices(eventId, "venue_booking_released_by_coordinator");
    expect(staffNotice).toMatchObject({ recipientId: users.venueStaff.id });
    expect(staffNotice.payload).toMatchObject({ venueRequestId: bookingId, venueName: HALL });
    expect(JSON.stringify(staffNotice.payload)).not.toContain("event");
    expect((await loadBlockedArrangements(database, [eventId])).get(eventId)).toBeUndefined();

    await liftBlock(block.id);

    expect((await bookingRow(bookingId)).status).toBe("released");
    expect(await ledgerForRequest(bookingId)).toEqual([]);
    expect((await bookingRow(replacementId)).status).toBe("approved");
    // Ready to re-confirm: exactly one approved booking, so the gate passes.
    const confirmed = await handleConfirmEvent({ id: eventId }, coordinator, database as never);
    expect(confirmed.status).toBe("confirmed");
  });

  it("refuses to release a booking that no block suspends, another Coordinator's, a pending request, and a second time", async () => {
    const { eventId, bookingId } = await confirmedEventWithBooking();
    await expect(release(bookingId)).rejects.toMatchObject({
      status: 409,
      message: VENUE_BOOKING_NOT_BLOCKED_MESSAGE,
    });

    const block = await recordBlock("09:00", "13:00");
    await expect(release(bookingId, otherCoordinator)).rejects.toMatchObject({ status: 403 });
    const pending = await handleCreateVenueRequest(
      { eventId, venueId: annexId, date: DATE, startTime: "10:00", endTime: "12:00" },
      coordinator,
      database as never
    );
    await expect(release(pending.id)).rejects.toMatchObject({ status: 409 });
    await expect(release("missing-booking")).rejects.toMatchObject({ status: 404 });

    await release(bookingId);
    await expect(release(bookingId)).rejects.toMatchObject({ status: 409 });
    // A lift after a partial cover never restores a released booking.
    await liftBlock(block.id);
    expect((await bookingRow(bookingId)).status).toBe("released");
  });

  it("closes registration while the event is back in planning, and lets the Coordinator adjust the terms (AC5)", async () => {
    const { eventId } = await confirmedEventWithBooking({
      registrationEnabled: true,
      registrationCapacity: 50,
      registrationOpensAt: "2027-01-02T09:00",
      registrationClosesAt: "2027-10-19T17:00",
    });
    await recordBlock("09:00", "13:00");

    await expect(
      handleRegisterForEvent({ id: eventId }, attendee, database as never)
    ).rejects.toMatchObject({ status: 403 });
    await expect(handleListEvents({ eventId }, attendee, database as never)).rejects.toMatchObject({
      status: 403,
    });

    const result = await handleUpdateEventInformation(
      { id: eventId, amendments: { registrationClosesAt: "2027-10-18T17:00" } },
      coordinator,
      database as never
    );
    expect(result.changedFields).toEqual(["attendeeRegistration"]);
  });

  it("tells the Organiser and every registered Attendee the arrangements when the event is confirmed again (AC6)", async () => {
    const { eventId, bookingId } = await confirmedEventWithBooking({
      registrationEnabled: true,
      registrationCapacity: 50,
      registrationOpensAt: "2027-01-02T09:00",
      registrationClosesAt: "2027-10-19T17:00",
    });
    await database.insert(schema.equipmentRequests).values({
      id: crypto.randomUUID(),
      eventId,
      item: "Projector",
      quantity: 1,
      arrangementStatus: "reserved",
    });
    await database
      .update(schema.eventRequests)
      .set({ equipmentArrangementsCompletedAt: new Date("2027-01-01T00:00:00Z") })
      .where(eq(schema.eventRequests.id, eventId));
    await database
      .insert(schema.eventRegistrations)
      .values({ eventId, attendeeId: users.attendee.id });
    const block = await recordBlock("09:00", "13:00");

    // The registered Attendee still reaches the event, but its suspended booking is not shown as
    // the current venue: the arrangements are pending until the event is confirmed again (O-25).
    const [attendeeView] = await handleListEvents({ eventId }, attendee, database as never);
    expect(attendeeView.access).toBe("attendee");
    expect(attendeeView.event).toMatchObject({ status: "planning", venue: null });

    await liftBlock(block.id);
    const [restoredView] = await handleListEvents({ eventId }, attendee, database as never);
    expect(restoredView.event.venue).toMatchObject({ name: HALL });

    const confirmed = await handleConfirmEvent({ id: eventId }, coordinator, database as never);

    expect(confirmed.status).toBe("confirmed");
    expect((await bookingRow(bookingId)).status).toBe("approved");
    const rows = await notices(eventId, "event_confirmed");
    expect(
      rows.map(row => [row.recipientId, (row.payload as { audience?: string }).audience])
    ).toEqual([
      [users.organiser.id, undefined],
      [users.attendee.id, "attendee"],
    ]);
    expect(rows[1].payload).toMatchObject({ venueName: HALL, startsAt: `${DATE} 10:00:00` });
    // The Attendee copy carries no equipment lines (PTR-44 AC3); the Organiser's copy keeps them.
    const attendeePayload = rows[1].payload as { equipment: unknown[] };
    const organiserPayload = rows[0].payload as { equipment: { item: string }[] };
    expect(attendeePayload.equipment).toEqual([]);
    expect(organiserPayload.equipment.map(line => line.item)).toEqual(["Projector"]);
  });
});
