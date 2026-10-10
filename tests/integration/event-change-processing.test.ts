// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleGetCoordinationRequest,
  handleListAssignedEventRequests,
} from "#/features/coordination/assignments.server";
import { handleRaiseEventChangeRequest } from "#/features/event-requests/change-requests.server";
import { handleGetEventRequest } from "#/features/event-requests/drafts.server";
import {
  CHANGE_REQUEST_APPLY_NO_CHANGE_MESSAGE,
  CHANGE_REQUEST_NOT_WAITING_MESSAGE,
  EVENT_CHANGE_REQUEST_CLOSED,
  SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE,
} from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import {
  handleDeclineEventChangeRequest,
  handleUpdateEventInformation,
} from "#/features/events/update.server";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const member = (id: string, role: string, name: string) => ({
  id,
  role,
  name,
  email: `${id}@example.com`,
});

const organiser = member("ptr52-organiser", "event_organiser", "Change Organiser");
const coordinator = member("ptr52-coordinator", "event_coordinator", "Change Coordinator");
const otherCoordinator = member("ptr52-other", "event_coordinator", "Other Coordinator");
const venueStaff = member("ptr52-venue-staff", "venue_staff", "Change Venue Staff");
const technicalSupport = member(
  "ptr52-tech-support",
  "technical_support_staff",
  "Change Technical Support"
);
const attendee = member("ptr52-attendee", "attendee", "Change Attendee");
const members = [organiser, coordinator, otherCoordinator, venueStaff, technicalSupport, attendee];
const EQUIPMENT_TYPE = "PTR52 Projector";

const recorded = {
  eventName: "PTR52 Planning Forum",
  purpose: "Agree the regional plan",
  proposedDates: [{ start: "2031-03-10T09:00", end: "2031-03-10T17:00" }],
  expectedAttendance: 80,
  description: "Annual planning forum",
  eventType: "Conference",
  venueRequirements: "A projector wall",
  roomLayoutPreference: "Theatre",
  accessibilityRequirements: "Step-free access",
  equipmentRequirements: [{ type: "Projector", quantity: 1 }],
  specialArrangements: "",
  registrationEnabled: false,
};

let pool: Pool;
let database: Database;
let venueId: number;
let equipmentTypeId: number;
let year = 2080;

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
  // A line from an earlier run still references the equipment type, so the events go first.
  await database
    .delete(schema.eventRequests)
    .where(eq(schema.eventRequests.organiserId, organiser.id));
  await database.insert(schema.user).values(members);
  venueId = (await database.select({ id: schema.venues.id }).from(schema.venues).limit(1))[0].id;
  await database
    .delete(schema.equipmentTypes)
    .where(eq(schema.equipmentTypes.name, EQUIPMENT_TYPE));
  const [type] = await database
    .insert(schema.equipmentTypes)
    .values({ name: EQUIPMENT_TYPE, quantityHeld: 50 })
    .returning({ id: schema.equipmentTypes.id });
  equipmentTypeId = type.id;
});

beforeEach(async () => {
  await database
    .delete(schema.eventRequests)
    .where(eq(schema.eventRequests.organiserId, organiser.id));
});

afterAll(async () => {
  await database
    .delete(schema.eventRequests)
    .where(eq(schema.eventRequests.organiserId, organiser.id));
  await database
    .delete(schema.equipmentTypes)
    .where(eq(schema.equipmentTypes.name, EQUIPMENT_TYPE));
  await database.delete(schema.user).where(
    inArray(
      schema.user.id,
      members.map(user => user.id)
    )
  );
  await pool.end();
});

function stageColumns(status: EventRequestStatus) {
  const at = new Date("2031-01-05T02:00:00Z");
  const decided = ["approved", "rejected", "planning", "confirmed", "completed"].includes(status);
  return {
    ...(decided
      ? {
          decidedByCoordinatorId: coordinator.id,
          decidedByCoordinatorName: coordinator.name,
          decidedAt: at,
          decisionReason: status === "rejected" ? "Not this year" : null,
        }
      : {}),
    ...(status === "confirmed"
      ? { confirmedById: coordinator.id, confirmedByName: coordinator.name, confirmedAt: at }
      : {}),
    ...(status === "completed"
      ? { completedById: coordinator.id, completedByName: coordinator.name, completedAt: at }
      : {}),
    ...(status === "cancelled"
      ? { cancelledById: coordinator.id, cancelledByName: coordinator.name, cancelledAt: at }
      : {}),
  };
}

async function eventAt(
  status: EventRequestStatus,
  extra: Partial<typeof schema.eventRequests.$inferInsert> = {}
) {
  const [event] = await database
    .insert(schema.eventRequests)
    .values({
      ...recorded,
      organiserId: organiser.id,
      status,
      submittedAt: status === "draft" ? null : new Date("2031-01-01T02:00:00Z"),
      assignedCoordinatorId: status === "draft" ? null : coordinator.id,
      assignedAt: status === "draft" ? null : new Date("2031-01-02T02:00:00Z"),
      ...stageColumns(status),
      ...extra,
    })
    .returning();
  return event;
}

/** A request the Organiser raised through the real path, so the Coordinator's notice exists too. */
async function raise(eventId: number, whatShouldChange = "Expected attendance") {
  return handleRaiseEventChangeRequest(
    { id: eventId, whatShouldChange, requestedValue: "120 attendees" },
    organiser,
    database as never
  );
}

/** A processed row, written as the Coordinator's decision left it. */
async function processedRequest(eventId: number) {
  const request = await raise(eventId, "Already done");
  await database
    .update(schema.eventChangeRequests)
    .set({
      outcome: "declined",
      declineReason: "Earlier",
      processedById: coordinator.id,
      processedByName: coordinator.name,
      processedAt: new Date(),
    })
    .where(eq(schema.eventChangeRequests.id, request.id));
  return request;
}

const apply = (
  eventId: number,
  changeRequestId: number,
  amendments: Record<string, unknown>,
  actor: SessionUser = coordinator,
  acknowledgeSignificant?: true
) =>
  handleUpdateEventInformation(
    { id: eventId, amendments, changeRequestId, acknowledgeSignificant },
    actor,
    database as never
  );

const decline = (
  eventId: number,
  changeRequestId: number,
  reason = "The hall holds 80 at most.",
  actor: SessionUser = coordinator
) =>
  handleDeclineEventChangeRequest(
    { id: eventId, changeRequestId, reason },
    actor,
    database as never
  );

const changeRequestRow = async (id: number) =>
  (
    await database
      .select()
      .from(schema.eventChangeRequests)
      .where(eq(schema.eventChangeRequests.id, id))
  )[0];

const storedEvent = async (id: number) =>
  (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0];

const organiserNotices = (eventId: number) =>
  database
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.eventRequestId, eventId),
        eq(schema.notifications.kind, "event_change_processed")
      )
    )
    .orderBy(asc(schema.notifications.id));

function nextWindow() {
  year += 1;
  return { startsAt: `${year}-03-10 09:00:00`, endsAt: `${year}-03-10 17:00:00` };
}

describe("processing a change request (PTR-52)", () => {
  it("counts the waiting requests on each of the Coordinator's assigned events (AC1)", async () => {
    const twoWaiting = await eventAt("approved");
    await raise(twoWaiting.id, "Date");
    await raise(twoWaiting.id, "Venue");
    await processedRequest(twoWaiting.id);
    const none = await eventAt("planning");

    const rows = await handleListAssignedEventRequests(coordinator, database as never);

    expect(rows.find(row => row.id === twoWaiting.id)?.changeRequestsWaiting).toBe(2);
    expect(rows.find(row => row.id === none.id)?.changeRequestsWaiting).toBe(0);
    // Both parties still see every request on the record, outcome included.
    const view = await handleGetCoordinationRequest(
      { id: twoWaiting.id },
      coordinator,
      database as never
    );
    expect(view.changeRequests.map(item => item.outcome)).toEqual([null, null, "declined"]);
  });

  it("applies a request by updating the event, logging the change, closing the request and telling the Organiser (AC2, AC5)", async () => {
    const event = await eventAt("planning");
    const request = await raise(event.id, "Event name");
    const before = new Date();

    const result = await apply(event.id, request.id, { eventName: "PTR52 Forum, renamed" });

    expect(result).toEqual({ changedFields: ["eventName"], notified: 0 });
    expect((await storedEvent(event.id)).eventName).toBe("PTR52 Forum, renamed");
    const row = await changeRequestRow(request.id);
    expect(row).toMatchObject({
      outcome: "applied",
      declineReason: null,
      processedById: coordinator.id,
      processedByName: coordinator.name,
    });
    expect(row.processedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    const log = await database
      .select()
      .from(schema.eventInformationChanges)
      .where(eq(schema.eventInformationChanges.eventRequestId, event.id));
    expect(log.map(entry => entry.field)).toEqual(["eventName"]);
    const notices = await organiserNotices(event.id);
    expect(
      notices.map(notice => ({ recipientId: notice.recipientId, payload: notice.payload }))
    ).toEqual([
      {
        recipientId: organiser.id,
        payload: {
          outcome: "applied",
          // The name as the apply left it.
          eventName: "PTR52 Forum, renamed",
          whatShouldChange: "Event name",
        },
      },
    ]);
    // The Organiser's own page shows the outcome.
    const view = await handleGetEventRequest({ id: event.id }, organiser, database as never);
    expect(view?.changeRequests[0]).toMatchObject({
      outcome: "applied",
      processedByName: coordinator.name,
    });
  });

  it.each([
    "submitted",
    "under_review",
    "awaiting_organiser",
    "approved",
    "rejected",
    "confirmed",
  ] satisfies EventRequestStatus[])("applies a request on a %s event", async status => {
    const event = await eventAt(status);
    const request = await raise(event.id, "Purpose");

    await apply(event.id, request.id, { purpose: "Agree the plan, revised" });

    expect(await storedEvent(event.id)).toMatchObject({
      status,
      purpose: "Agree the plan, revised",
    });
    expect((await changeRequestRow(request.id)).outcome).toBe("applied");
  });

  it("still refuses a direct edit of a submitted event without a request", async () => {
    const event = await eventAt("submitted");

    await expect(
      handleUpdateEventInformation(
        { id: event.id, amendments: { purpose: "Sneaked in" } },
        coordinator,
        database as never
      )
    ).rejects.toMatchObject({ status: 409 });
    expect((await storedEvent(event.id)).purpose).toBe(recorded.purpose);
  });

  it.each(["completed", "cancelled"] satisfies EventRequestStatus[])(
    "refuses to apply on a %s event and leaves the request waiting",
    async status => {
      const open = await eventAt("confirmed");
      const request = await raise(open.id);
      await database
        .update(schema.eventRequests)
        .set({ status, ...stageColumns(status) })
        .where(eq(schema.eventRequests.id, open.id));

      await expect(apply(open.id, request.id, { purpose: "Too late" })).rejects.toMatchObject({
        status: 409,
        message: EVENT_CHANGE_REQUEST_CLOSED,
      });
      expect((await changeRequestRow(request.id)).outcome).toBeNull();
      expect((await storedEvent(open.id)).purpose).toBe(recorded.purpose);
      // A decline still records the outcome and tells the Organiser.
      await decline(open.id, request.id);
      expect((await changeRequestRow(request.id)).outcome).toBe("declined");
    }
  );

  it("refuses an apply that changes nothing, and leaves the request waiting", async () => {
    const event = await eventAt("approved");
    const request = await raise(event.id);

    await expect(apply(event.id, request.id, {})).rejects.toMatchObject({
      status: 409,
      message: CHANGE_REQUEST_APPLY_NO_CHANGE_MESSAGE,
    });
    await expect(
      apply(event.id, request.id, { expectedAttendance: recorded.expectedAttendance })
    ).rejects.toMatchObject({ status: 409, message: CHANGE_REQUEST_APPLY_NO_CHANGE_MESSAGE });
    expect((await changeRequestRow(request.id)).outcome).toBeNull();
    expect(await organiserNotices(event.id)).toEqual([]);
  });

  it("warns about a significant change on an apply too, and leaves the request waiting until acknowledged (AC3)", async () => {
    const event = await eventAt("approved");
    const request = await raise(event.id);

    await expect(apply(event.id, request.id, { expectedAttendance: 120 })).rejects.toMatchObject({
      status: 409,
      message: SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE,
    });
    expect((await changeRequestRow(request.id)).outcome).toBeNull();
    expect((await storedEvent(event.id)).expectedAttendance).toBe(recorded.expectedAttendance);

    await apply(event.id, request.id, { expectedAttendance: 120 }, coordinator, true);

    expect((await storedEvent(event.id)).expectedAttendance).toBe(120);
    expect((await changeRequestRow(request.id)).outcome).toBe("applied");
  });

  it("alters no booking, hold, reservation, registration or status when a request is applied (AC4)", async () => {
    const event = await eventAt("confirmed", {
      registrationEnabled: true,
      registrationCapacity: 60,
      registrationOpensAt: "2031-02-01T09:00",
      registrationClosesAt: "2031-03-01T17:00",
    });
    const request = await raise(event.id);
    const bookingId = crypto.randomUUID();
    await database.insert(schema.venueRequests).values({
      id: bookingId,
      eventId: event.id,
      venueId,
      requestedById: coordinator.id,
      assignedStaffId: venueStaff.id,
      ...nextWindow(),
      status: "approved",
    });
    const holdId = crypto.randomUUID();
    await database.insert(schema.venueHolds).values({
      id: holdId,
      eventId: event.id,
      venueId,
      heldById: coordinator.id,
      ...nextWindow(),
    });
    await database
      .insert(schema.eventRegistrations)
      .values({ eventId: event.id, attendeeId: attendee.id });
    const lineId = crypto.randomUUID();
    await database.insert(schema.equipmentRequests).values({
      id: lineId,
      eventId: event.id,
      equipmentTypeId,
      assignedStaffId: technicalSupport.id,
      item: EQUIPMENT_TYPE,
      quantity: 2,
      arrangementStatus: "reserved",
    });
    await database.insert(schema.equipmentReservations).values({
      id: crypto.randomUUID(),
      equipmentRequestId: lineId,
      equipmentTypeId,
      quantity: 2,
      ...nextWindow(),
    });
    const snapshot = () =>
      Promise.all([
        database.select().from(schema.venueRequests).where(eq(schema.venueRequests.id, bookingId)),
        database.select().from(schema.venueHolds).where(eq(schema.venueHolds.id, holdId)),
        database
          .select()
          .from(schema.equipmentRequests)
          .where(eq(schema.equipmentRequests.id, lineId)),
        database
          .select()
          .from(schema.equipmentReservations)
          .where(eq(schema.equipmentReservations.equipmentRequestId, lineId)),
        database
          .select()
          .from(schema.eventRegistrations)
          .where(eq(schema.eventRegistrations.eventId, event.id)),
      ]);
    const before = await snapshot();

    const result = await apply(
      event.id,
      request.id,
      { expectedAttendance: 120 },
      coordinator,
      true
    );

    expect(await snapshot()).toEqual(before);
    expect((await storedEvent(event.id)).status).toBe("confirmed");
    // The holders are told as for any significant change (PTR-23 AC5), and counted apart from
    // the Organiser's own notice.
    expect(result.notified).toBe(2);
    const holderNotices = await database
      .select({ recipientId: schema.notifications.recipientId })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventRequestId, event.id),
          eq(schema.notifications.kind, "event_significant_change")
        )
      );
    expect(holderNotices.map(notice => notice.recipientId).toSorted()).toEqual(
      [venueStaff.id, technicalSupport.id].toSorted()
    );
    expect(await organiserNotices(event.id)).toHaveLength(1);
  });

  it("lets exactly one of two concurrent applies on the same request win", async () => {
    const event = await eventAt("approved");
    const request = await raise(event.id, "Purpose");

    const outcomes = await Promise.allSettled([
      apply(event.id, request.id, { purpose: "First" }),
      apply(event.id, request.id, { purpose: "Second" }),
    ]);

    expect(outcomes.map(outcome => outcome.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    const rejected = outcomes.find(outcome => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      reason: { status: 409, message: CHANGE_REQUEST_NOT_WAITING_MESSAGE },
    });
    expect((await changeRequestRow(request.id)).outcome).toBe("applied");
    expect(await organiserNotices(event.id)).toHaveLength(1);
  });

  it("refuses a request that is not this event's, already processed, or missing (AC2)", async () => {
    const event = await eventAt("approved");
    const other = await eventAt("approved");
    const foreign = await raise(other.id);
    const processed = await processedRequest(event.id);

    const ids = [foreign.id, processed.id, 2_000_000_000];
    const notWaiting = { status: 409, message: CHANGE_REQUEST_NOT_WAITING_MESSAGE };
    await Promise.all([
      ...ids.map(changeRequestId =>
        expect(apply(event.id, changeRequestId, { purpose: "x" })).rejects.toMatchObject(notWaiting)
      ),
      ...ids.map(changeRequestId =>
        expect(decline(event.id, changeRequestId)).rejects.toMatchObject(notWaiting)
      ),
    ]);
    expect((await changeRequestRow(foreign.id)).outcome).toBeNull();
    expect((await storedEvent(event.id)).purpose).toBe(recorded.purpose);
  });

  it("refuses another Coordinator, an unassigned event, a draft and a missing id the same way", async () => {
    const assigned = await eventAt("approved");
    const request = await raise(assigned.id);
    const unassigned = await eventAt("approved", { assignedCoordinatorId: null });
    const draft = await eventAt("draft");

    const refusals = [
      [assigned.id, otherCoordinator],
      [unassigned.id, coordinator],
      [draft.id, coordinator],
      [2_000_000_000, coordinator],
    ] as const;
    const forbidden = { status: 403, message: "Forbidden" };
    await Promise.all([
      ...refusals.map(([id, actor]) =>
        expect(apply(id, request.id, { purpose: "x" }, actor)).rejects.toMatchObject(forbidden)
      ),
      ...refusals.map(([id, actor]) =>
        expect(decline(id, request.id, "x", actor)).rejects.toMatchObject(forbidden)
      ),
    ]);
    expect((await changeRequestRow(request.id)).outcome).toBeNull();
  });

  it("declines a request with a reason, leaves the event as it is, and tells the Organiser (AC2, AC5)", async () => {
    // Raised while the event was open, decided after it completed: a decline is open in any status.
    const event = await eventAt("confirmed");
    const request = await raise(event.id);
    await database
      .update(schema.eventRequests)
      .set({ status: "completed", ...stageColumns("completed") })
      .where(eq(schema.eventRequests.id, event.id));
    const before = await storedEvent(event.id);

    const declined = await decline(event.id, request.id, "The hall holds 80 at most.");

    expect(declined).toMatchObject({
      outcome: "declined",
      declineReason: "The hall holds 80 at most.",
      processedById: coordinator.id,
      processedByName: coordinator.name,
    });
    expect(await storedEvent(event.id)).toEqual(before);
    const notices = await organiserNotices(event.id);
    expect(
      notices.map(notice => ({ recipientId: notice.recipientId, payload: notice.payload }))
    ).toEqual([
      {
        recipientId: organiser.id,
        payload: {
          outcome: "declined",
          eventName: recorded.eventName,
          whatShouldChange: "Expected attendance",
          reason: "The hall holds 80 at most.",
        },
      },
    ]);
    // A second decision on the same request is refused.
    await expect(decline(event.id, request.id)).rejects.toMatchObject({
      status: 409,
      message: CHANGE_REQUEST_NOT_WAITING_MESSAGE,
    });
  });

  it("processes two waiting requests on one event independently", async () => {
    const event = await eventAt("approved");
    const first = await raise(event.id, "Purpose");
    const second = await raise(event.id, "Date");

    await apply(event.id, first.id, { purpose: "Agree the plan, revised" });
    await decline(event.id, second.id, "The venue is only free that day.");

    expect((await changeRequestRow(first.id)).outcome).toBe("applied");
    expect((await changeRequestRow(second.id)).outcome).toBe("declined");
    expect((await organiserNotices(event.id)).map(notice => notice.payload)).toMatchObject([
      { outcome: "applied" },
      { outcome: "declined" },
    ]);
  });
});
