// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { handleGetEventRequest } from "#/features/event-requests/drafts.server";
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
const attendee = member("ptr22-attendee", "attendee", "Planning Attendee");
const members = [organiser, coordinator, otherCoordinator, venueStaff, attendee];

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

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  database = drizzle(pool, { schema });
  await database.insert(schema.user).values(members);
  // The global setup seeds the venue catalogue.
  venueId = (await database.select({ id: schema.venues.id }).from(schema.venues).limit(1))[0].id;
});

beforeEach(async () => {
  await database
    .delete(schema.eventRequests)
    .where(eq(schema.eventRequests.organiserId, organiser.id));
});

afterAll(async () => {
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
function update(id: number, amendments: Record<string, unknown>, actor: SessionUser = coordinator) {
  return handleUpdateEventInformation({ id, amendments }, actor, database as never);
}

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

    const result = await update(event.id, {
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
  });

  it.each(["planning", "confirmed"] as const)("saves an update of a %s event", async status => {
    const event = await eventAt(status);

    await update(event.id, { venueRequirements: "A projector wall and a hearing loop" });

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

    await expect(update(event.id, { expectedAttendance: null })).rejects.toThrow(
      "This request is missing: Expected attendance"
    );
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

    await update(event.id, {
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
