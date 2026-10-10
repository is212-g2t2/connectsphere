// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { handleGetEventRequest } from "#/features/event-requests/drafts.server";
import { SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE } from "#/features/event-requests/schema";
import { handleListEventArrangements } from "#/features/events/arrangements.server";
import { handleListEvents } from "#/features/events/records.server";
import { handleUpdateEventInformation } from "#/features/events/update.server";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const member = (id: string, role: string, name: string) => ({
  id,
  role,
  name,
  email: `${id}@example.com`,
});

const organiser = member("ptr22-organiser", "event_organiser", "Planning Organiser");
const coordinator = member("ptr22-coordinator", "event_coordinator", "Planning Coordinator");
const otherCoordinator = member("ptr22-other", "event_coordinator", "Other Coordinator");
const venueStaff = member("ptr22-venue-staff", "venue_staff", "Planning Venue Staff");
const otherVenueStaff = member("ptr22-venue-staff-2", "venue_staff", "Other Venue Staff");
const technicalSupport = member(
  "ptr22-tech-support",
  "technical_support_staff",
  "Planning Technical Support"
);
const attendee = member("ptr22-attendee", "attendee", "Planning Attendee");
const members = [
  organiser,
  coordinator,
  otherCoordinator,
  venueStaff,
  otherVenueStaff,
  technicalSupport,
  attendee,
];
const EQUIPMENT_TYPE = "PTR23 Projector";

/** What the event holds before an update. */
const recorded = {
  eventName: "PTR22 Planning Forum",
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
// A distant year per booking, hold and reservation keeps the overlap constraints from tripping.
let year = 2070;

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
  // A line from an earlier run still references the equipment type, so the events go first.
  await database
    .delete(schema.eventRequests)
    .where(eq(schema.eventRequests.organiserId, organiser.id));
  await database.insert(schema.user).values(members);
  // The global setup seeds the venue catalogue.
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
  // The last test's lines still reference the equipment type, so the events go first.
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

/** The columns each status's CHECK constraints require, so a fixture row is a legal one. */
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

/** Sends only the changed columns, as the Coordinator's form does. */
function update(
  id: number,
  amendments: Record<string, unknown>,
  actor: SessionUser = coordinator,
  acknowledgeSignificant?: true
) {
  return handleUpdateEventInformation(
    { id, amendments, acknowledgeSignificant },
    actor,
    database as never
  );
}

/** A significant change the Coordinator has read the warning for. */
const updateAcknowledged = (id: number, amendments: Record<string, unknown>) =>
  update(id, amendments, coordinator, true);

function nextWindow() {
  year += 1;
  return { startsAt: `${year}-03-10 09:00:00`, endsAt: `${year}-03-10 17:00:00` };
}

async function addBooking(
  eventId: number,
  status: "pending" | "approved" | "released" = "approved",
  staffId: string | null = venueStaff.id
) {
  const id = crypto.randomUUID();
  await database.insert(schema.venueRequests).values({
    id,
    eventId,
    venueId,
    requestedById: coordinator.id,
    assignedStaffId: status === "pending" ? null : staffId,
    ...nextWindow(),
    status,
    ...(status === "released" ? { releaseReason: "Maintenance" } : {}),
  });
  return id;
}

async function addHold(eventId: number, status: "held" | "released" = "held") {
  const id = crypto.randomUUID();
  await database.insert(schema.venueHolds).values({
    id,
    eventId,
    venueId,
    heldById: coordinator.id,
    status,
    ...nextWindow(),
  });
  return id;
}

async function addReservedLine(
  eventId: number,
  quantity = 3,
  staffId: string | null = technicalSupport.id
) {
  const id = crypto.randomUUID();
  await database.insert(schema.equipmentRequests).values({
    id,
    eventId,
    equipmentTypeId,
    assignedStaffId: staffId,
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

const significantChangeNotices = (eventId: number) =>
  database
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.eventRequestId, eventId),
        eq(schema.notifications.kind, "event_significant_change")
      )
    )
    .orderBy(asc(schema.notifications.id));

const listArrangements = (id: number, actor: SessionUser = coordinator) =>
  handleListEventArrangements({ id }, actor, database);

async function storedEvent(id: number) {
  return (
    await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id))
  )[0];
}

async function changeLog(id: number) {
  return database
    .select()
    .from(schema.eventInformationChanges)
    .where(eq(schema.eventInformationChanges.eventRequestId, id))
    .orderBy(asc(schema.eventInformationChanges.id));
}

describe("updating event information (PTR-22)", () => {
  it("saves the assigned Coordinator's update of an approved event and records each changed field", async () => {
    const event = await eventAt("approved");

    // The attendance and dates are significant (PTR-23), so this save carries the acknowledgement.
    const result = await updateAcknowledged(event.id, {
      eventName: "PTR22 Regional Planning Forum",
      expectedAttendance: 120,
      proposedDates: [{ start: "2031-03-11T09:00", end: "2031-03-11T18:00" }],
    });

    expect(result.changedFields).toEqual(["eventName", "proposedDates", "expectedAttendance"]);
    expect(await storedEvent(event.id)).toMatchObject({
      status: "approved",
      eventName: "PTR22 Regional Planning Forum",
      expectedAttendance: 120,
      proposedDates: [{ start: "2031-03-11T09:00", end: "2031-03-11T18:00" }],
      purpose: recorded.purpose,
    });

    const log = await changeLog(event.id);
    expect(log.map(({ field, amendment }) => ({ field, amendment }))).toEqual([
      {
        field: "eventName",
        amendment: { from: "PTR22 Planning Forum", to: "PTR22 Regional Planning Forum" },
      },
      {
        field: "proposedDates",
        amendment: {
          from: [{ start: "2031-03-10T09:00", end: "2031-03-10T17:00" }],
          to: [{ start: "2031-03-11T09:00", end: "2031-03-11T18:00" }],
        },
      },
      { field: "expectedAttendance", amendment: { from: 80, to: 120 } },
    ]);
    for (const row of log) {
      expect(row).toMatchObject({ changedById: coordinator.id, changedByName: coordinator.name });
      expect(row.changedAt).toBeInstanceOf(Date);
    }
    // One save stamps every row with the same apply time.
    expect(new Set(log.map(row => row.changedAt.getTime())).size).toBe(1);
  });

  it.each(["planning", "confirmed"] as const)("saves an update of a %s event", async status => {
    const event = await eventAt(status);

    await updateAcknowledged(event.id, {
      venueRequirements: "A projector wall and a hearing loop",
    });

    expect(await storedEvent(event.id)).toMatchObject({
      status,
      venueRequirements: "A projector wall and a hearing loop",
    });
    expect(await changeLog(event.id)).toHaveLength(1);
  });

  it.each(["completed", "cancelled"] as const)(
    "refuses an update of a %s event and changes nothing",
    async status => {
      const event = await eventAt(status);

      await expect(update(event.id, { eventName: "Too late" })).rejects.toMatchObject({
        status: 409,
        message: `This event's information cannot be updated while its status is ${status}.`,
      });
      expect((await storedEvent(event.id)).eventName).toBe(recorded.eventName);
      expect(await changeLog(event.id)).toEqual([]);
    }
  );

  it.each(["submitted", "under_review", "awaiting_organiser", "rejected"] as const)(
    "refuses an update of a %s event",
    async status => {
      const event = await eventAt(status);

      await expect(update(event.id, { eventName: "Not yet" })).rejects.toMatchObject({
        status: 409,
      });
      expect(await changeLog(event.id)).toEqual([]);
    }
  );

  it("refuses another Coordinator, an unassigned event, a draft and a missing id the same way", async () => {
    const assigned = await eventAt("approved");
    const unassigned = await eventAt("approved", { assignedCoordinatorId: null });
    const draft = await eventAt("draft");

    const refusals = [
      [assigned.id, otherCoordinator],
      [unassigned.id, coordinator],
      [draft.id, coordinator],
      [2_000_000_000, coordinator],
    ] as const;
    await Promise.all(
      refusals.map(([id, actor]) =>
        expect(update(id, { eventName: "Not mine" }, actor)).rejects.toMatchObject({
          status: 403,
          message: "Forbidden",
        })
      )
    );
    expect((await storedEvent(assigned.id)).eventName).toBe(recorded.eventName);
    expect(await changeLog(assigned.id)).toEqual([]);
  });

  it("writes nothing when no value changed", async () => {
    const event = await eventAt("confirmed");

    expect((await update(event.id, {})).changedFields).toEqual([]);
    expect(
      (
        await update(event.id, {
          eventName: recorded.eventName,
          proposedDates: [{ end: "2031-03-10T17:00", start: "2031-03-10T09:00" }],
        })
      ).changedFields
    ).toEqual([]);
    expect((await storedEvent(event.id)).updatedAt).toEqual(event.updatedAt);
    expect(await changeLog(event.id)).toEqual([]);
  });

  it("keeps the stored value of every field that the update does not carry", async () => {
    const event = await eventAt("approved");

    await update(event.id, { eventName: "PTR22 Renamed in one tab" });
    // A second form, opened before the rename, changes only the purpose.
    await update(event.id, { purpose: "Agree the regional and local plans" });

    expect(await storedEvent(event.id)).toMatchObject({
      eventName: "PTR22 Renamed in one tab",
      purpose: "Agree the regional and local plans",
      description: recorded.description,
      equipmentRequirements: recorded.equipmentRequirements,
    });
  });

  it("reads back a text value that looks like JSON as the text it was", async () => {
    const event = await eventAt("approved");

    await update(event.id, { eventName: "2032", purpose: "true", description: "null" });

    expect((await changeLog(event.id)).map(row => row.amendment.to)).toEqual([
      "2032",
      "true",
      "null",
    ]);
  });

  it("refuses an update that clears a field the event needs", async () => {
    const event = await eventAt("approved");

    await expect(update(event.id, { expectedAttendance: null })).rejects.toMatchObject({
      status: 409,
      message: "This request is missing: Expected attendance",
    });
    expect((await storedEvent(event.id)).expectedAttendance).toBe(recorded.expectedAttendance);
    expect(await changeLog(event.id)).toEqual([]);
  });

  it("records the registration terms as one change, and clears them when registration is turned off", async () => {
    const event = await eventAt("confirmed");
    const terms = {
      registrationEnabled: true,
      registrationCapacity: 60,
      registrationOpensAt: "2031-02-01T09:00",
      registrationClosesAt: "2031-03-01T17:00",
    };

    await update(event.id, terms);
    await update(event.id, { registrationEnabled: false });

    expect(await storedEvent(event.id)).toMatchObject({
      registrationEnabled: false,
      registrationCapacity: null,
      registrationOpensAt: null,
      registrationClosesAt: null,
    });
    const log = await changeLog(event.id);
    expect(log.map(row => row.field)).toEqual(["attendeeRegistration", "attendeeRegistration"]);
    expect(log[0].amendment.to).toEqual(terms);
    expect(log[1].amendment).toEqual({
      from: terms,
      to: {
        registrationEnabled: false,
        registrationCapacity: null,
        registrationOpensAt: null,
        registrationClosesAt: null,
      },
    });
  });

  it("shows every other user with access the new value on their next read (AC3)", async () => {
    const event = await eventAt("confirmed", {
      registrationEnabled: true,
      registrationCapacity: 60,
      registrationOpensAt: "2031-02-01T09:00",
      registrationClosesAt: "2031-03-01T17:00",
    });
    await database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      venueId,
      requestedById: coordinator.id,
      assignedStaffId: venueStaff.id,
      startsAt: "2031-03-10 09:00:00",
      endsAt: "2031-03-10 17:00:00",
      status: "approved",
    });

    await updateAcknowledged(event.id, {
      eventName: "PTR22 Forum, renamed",
      description: "Moved to the main hall",
      expectedAttendance: 150,
    });

    expect(
      await handleGetEventRequest({ id: event.id }, organiser, database as never)
    ).toMatchObject({ eventName: "PTR22 Forum, renamed", expectedAttendance: 150 });
    const [asVenueStaff] = await handleListEvents(
      { eventId: event.id },
      venueStaff,
      database as never
    );
    expect(asVenueStaff.event.expectedAttendance).toBe(150);
    const [asAttendee] = await handleListEvents({ eventId: event.id }, attendee, database as never);
    expect(asAttendee.event).toMatchObject({
      name: "PTR22 Forum, renamed",
      description: "Moved to the main hall",
    });
  });
});

describe("warning before a significant change (PTR-23)", () => {
  it("refuses a significant change sent without the acknowledgement, and writes nothing (AC2)", async () => {
    const event = await eventAt("approved");
    await addBooking(event.id);

    await Promise.all(
      [
        { proposedDates: [{ start: "2031-03-10T09:00", end: "2031-03-10T18:00" }] },
        { expectedAttendance: 120 },
        { venueRequirements: "A projector wall and a stage" },
        { equipmentRequirements: [{ type: "Projector", quantity: 2 }] },
        // One significant field among ordinary ones is enough.
        { eventName: "PTR23 Renamed", expectedAttendance: 120 },
      ].map(amendments =>
        expect(update(event.id, amendments)).rejects.toMatchObject({
          status: 409,
          message: SIGNIFICANT_CHANGE_UNACKNOWLEDGED_MESSAGE,
        })
      )
    );
    expect(await storedEvent(event.id)).toMatchObject({
      eventName: recorded.eventName,
      expectedAttendance: recorded.expectedAttendance,
      proposedDates: recorded.proposedDates,
    });
    expect(await changeLog(event.id)).toEqual([]);
    expect(await significantChangeNotices(event.id)).toEqual([]);
  });

  it("saves an ordinary edit without the acknowledgement and tells no one, even when arrangements are held (AC1, AC4)", async () => {
    const event = await eventAt("confirmed");
    await addBooking(event.id);
    await addHold(event.id);
    await addReservedLine(event.id);

    const result = await update(event.id, {
      eventName: "PTR23 Renamed",
      roomLayoutPreference: "Cabaret",
      accessibilityRequirements: "Hearing loop",
      registrationEnabled: true,
      registrationCapacity: 60,
      registrationOpensAt: "2031-02-01T09:00",
      registrationClosesAt: "2031-03-01T17:00",
    });

    expect(result.notified).toBe(0);
    expect(result.changedFields).toEqual([
      "eventName",
      "roomLayoutPreference",
      "accessibilityRequirements",
      "attendeeRegistration",
    ]);
    expect(await significantChangeNotices(event.id)).toEqual([]);
  });

  it("treats a significant field typed over and restored as no change", async () => {
    const event = await eventAt("approved");
    await addBooking(event.id);

    const result = await update(event.id, {
      expectedAttendance: recorded.expectedAttendance,
      purpose: "Agree the regional plan, again",
    });

    expect(result).toEqual({ changedFields: ["purpose"], notified: 0 });
  });

  it("names a Coordinator with a blank name by role in the notices and by email in the change log", async () => {
    const event = await eventAt("approved");
    await addBooking(event.id);

    await update(event.id, { expectedAttendance: 120 }, { ...coordinator, name: "  " }, true);

    const [notice] = await significantChangeNotices(event.id);
    expect(notice.payload).toMatchObject({ actorName: "The Coordinator" });
    expect((await changeLog(event.id)).map(row => row.changedByName)).toEqual([coordinator.email]);
  });

  it("saves an acknowledged significant change, logs it, and tells the Venue Staff on each booking and each Technical Support member once (AC5)", async () => {
    const event = await eventAt("confirmed");
    const firstBooking = await addBooking(event.id);
    await addBooking(event.id, "approved", otherVenueStaff.id);
    await addHold(event.id);
    await addReservedLine(event.id, 3);
    await addReservedLine(event.id, 1);

    const result = await updateAcknowledged(event.id, {
      eventName: "PTR23 Renamed",
      expectedAttendance: 120,
      proposedDates: [{ start: "2031-03-10T09:00", end: "2031-03-10T18:00" }],
    });

    expect(result).toEqual({
      changedFields: ["eventName", "proposedDates", "expectedAttendance"],
      notified: 3,
    });
    expect(await storedEvent(event.id)).toMatchObject({
      status: "confirmed",
      expectedAttendance: 120,
    });
    expect((await changeLog(event.id)).map(row => row.field)).toEqual([
      "eventName",
      "proposedDates",
      "expectedAttendance",
    ]);

    const notices = await significantChangeNotices(event.id);
    const [first] = await database
      .select({ startsAt: schema.venueRequests.startsAt, endsAt: schema.venueRequests.endsAt })
      .from(schema.venueRequests)
      .where(eq(schema.venueRequests.id, firstBooking));
    const [venue] = await database
      .select({ name: schema.venues.name })
      .from(schema.venues)
      .where(eq(schema.venues.id, venueId));
    expect(notices.map(row => ({ recipientId: row.recipientId, payload: row.payload }))).toEqual([
      {
        recipientId: venueStaff.id,
        payload: {
          audience: "venue_staff",
          venueName: venue.name,
          startsAt: first.startsAt,
          endsAt: first.endsAt,
          changedFields: ["proposedDates", "expectedAttendance"],
          actorName: coordinator.name,
        },
      },
      {
        recipientId: otherVenueStaff.id,
        payload: expect.objectContaining({ audience: "venue_staff" }),
      },
      {
        recipientId: technicalSupport.id,
        payload: {
          audience: "technical_support",
          // The name as the same save left it, not the one it replaced.
          eventName: "PTR23 Renamed",
          changedFields: ["proposedDates", "expectedAttendance"],
          actorName: coordinator.name,
        },
      },
    ]);
    // The Venue Staff copy never names the event (PTR-8).
    for (const name of [recorded.eventName, "PTR23 Renamed"]) {
      expect(JSON.stringify(notices[0].payload)).not.toContain(name);
    }
  });

  it("changes, cancels and releases no arrangement (AC3)", async () => {
    const event = await eventAt("confirmed");
    const bookingId = await addBooking(event.id);
    const holdId = await addHold(event.id);
    const lineId = await addReservedLine(event.id, 3);
    const arrangements = () =>
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
      ]);
    const before = await arrangements();

    await updateAcknowledged(event.id, {
      proposedDates: [{ start: "2031-04-01T09:00", end: "2031-04-01T18:00" }],
      equipmentRequirements: [{ type: "Projector", quantity: 4 }],
    });

    // Every column of every row, not only the status: nothing is amended, released or re-dated.
    expect(await arrangements()).toEqual(before);
    expect(before[0][0].status).toBe("approved");
    expect(before[1][0].status).toBe("held");
    expect(before[2][0]).toMatchObject({ arrangementStatus: "reserved", quantity: 3 });
    expect((await storedEvent(event.id)).status).toBe("confirmed");
  });

  it("tells no one for a booking or line whose staff account has gone, for a hold, or when nothing is held (AC5)", async () => {
    const event = await eventAt("approved");
    await addBooking(event.id, "approved", null);
    await addBooking(event.id, "pending");
    await addBooking(event.id, "released");
    await addHold(event.id);
    await addReservedLine(event.id, 2, null);

    expect((await updateAcknowledged(event.id, { expectedAttendance: 120 })).notified).toBe(0);
    expect(await significantChangeNotices(event.id)).toEqual([]);

    const bare = await eventAt("approved");
    expect((await updateAcknowledged(bare.id, { expectedAttendance: 120 })).notified).toBe(0);
  });

  it("lists what the event holds for its assigned Coordinator: approved bookings, held holds and reservations (AC3)", async () => {
    const event = await eventAt("planning");
    const bookingId = await addBooking(event.id);
    await addBooking(event.id, "pending");
    await addBooking(event.id, "released");
    const holdId = await addHold(event.id);
    await addHold(event.id, "released");
    const lineId = await addReservedLine(event.id, 2);

    const arrangements = await listArrangements(event.id);

    expect(arrangements.venueBookings.map(booking => booking.id)).toEqual([bookingId]);
    expect(arrangements.venueHolds.map(hold => hold.id)).toEqual([holdId]);
    expect(arrangements.equipmentReservations).toEqual([
      { id: lineId, item: EQUIPMENT_TYPE, quantity: 2 },
    ]);
    expect(await listArrangements((await eventAt("approved")).id)).toEqual({
      venueBookings: [],
      venueHolds: [],
      equipmentReservations: [],
    });
  });

  it("refuses the arrangements of another Coordinator's event, an unassigned event and a missing id the same way", async () => {
    const assigned = await eventAt("approved");
    const unassigned = await eventAt("approved", { assignedCoordinatorId: null });

    await Promise.all(
      (
        [
          [assigned.id, otherCoordinator],
          [unassigned.id, coordinator],
          [2_000_000_000, coordinator],
        ] as const
      ).map(([id, actor]) =>
        expect(listArrangements(id, actor)).rejects.toMatchObject({
          status: 403,
          message: "Forbidden",
        })
      )
    );
  });
});
