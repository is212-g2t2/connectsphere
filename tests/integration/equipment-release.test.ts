// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleCheckEquipmentAvailability } from "#/features/equipment-requests/availability.server";
import { handleUpdateArrangement } from "#/features/equipment-requests/equipment.server";
import {
  handleReleaseEquipment,
  handleReserveEquipment,
} from "#/features/equipment-requests/reservations.server";
import {
  RELEASE_NO_RESERVATION_MESSAGE,
  RELEASE_NOT_LOWER_MESSAGE,
  RELEASE_REASON_NEEDS_RELEASE_MESSAGE,
} from "#/features/equipment-requests/schema";
import { handleListEvents } from "#/features/events/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const fixtureUsers = {
  tech1: {
    id: "eq-rel-tech-1",
    name: "Release Tech One",
    email: "release-tech1@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
  tech2: {
    id: "eq-rel-tech-2",
    name: "Release Tech Two",
    email: "release-tech2@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
  coordinator: {
    id: "eq-rel-coord-1",
    name: "Release Coordinator",
    email: "release-coord@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  organiser: {
    id: "eq-rel-org-1",
    name: "Release Organiser",
    email: "release-org@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
};

const session = (userKey: keyof typeof fixtureUsers): SessionUser => fixtureUsers[userKey];

const WINDOW = { startsAt: "2031-03-10 09:00:00", endsAt: "2031-03-10 17:00:00" };

describe("Reduce or release a reservation (PTR-42)", () => {
  let pool: Pool;
  let database: Database;
  let typeId: number;
  let typeName: string;
  let venueId: number;
  let venueId2: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await cleanup();
    await Promise.all(
      Object.values(fixtureUsers).map(u =>
        database.insert(schema.user).values(u).onConflictDoNothing()
      )
    );
    const [venue1, venue2] = await database
      .insert(schema.venues)
      .values([
        {
          name: `Release Test Hall 1 ${Date.now()}`,
          location: "Building R",
          maxCapacity: 200,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
        {
          name: `Release Test Hall 2 ${Date.now()}`,
          location: "Building S",
          maxCapacity: 100,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
      ])
      .returning({ id: schema.venues.id });
    venueId = venue1.id;
    venueId2 = venue2.id;
    // 5 held, none unavailable: 5 serviceable.
    typeName = `PTR42 Test Mixer ${Date.now()}`;
    const [type] = await database
      .insert(schema.equipmentTypes)
      .values({ name: typeName, quantityHeld: 5 })
      .returning({ id: schema.equipmentTypes.id });
    typeId = type.id;
  });

  afterAll(async () => {
    await cleanup();
    if (typeId) {
      await database.delete(schema.equipmentTypes).where(eq(schema.equipmentTypes.id, typeId));
    }
    await database.delete(schema.venues).where(inArray(schema.venues.id, [venueId, venueId2]));
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        Object.values(fixtureUsers).map(u => u.id)
      )
    );
    await pool.end();
  });

  async function cleanup() {
    const events = await database
      .select({ id: schema.eventRequests.id })
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.organiserId, fixtureUsers.organiser.id));
    if (events.length === 0) return;
    const eventIds = events.map(e => e.id);
    // Events cascade to bookings, lines and reservations.
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, eventIds));
  }

  /** An approved, equipment-submitted event with one requested line on its own venue. */
  async function createEvent(params: {
    name: string;
    requested?: number;
    venue?: number;
    assignedStaffId?: string | null;
    coordinatorId?: string | null;
  }) {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.organiser.id,
        eventName: params.name,
        purpose: "PTR-42 Testing",
        status: "approved",
        assignedCoordinatorId:
          params.coordinatorId === undefined ? fixtureUsers.coordinator.id : params.coordinatorId,
        assignedAt: new Date(),
        decidedByCoordinatorId: fixtureUsers.coordinator.id,
        decidedByCoordinatorName: fixtureUsers.coordinator.name,
        decidedAt: new Date(),
        submittedAt: new Date(),
        equipmentSubmittedAt: new Date(),
        proposedDates: [
          { start: WINDOW.startsAt.replace(" ", "T"), end: WINDOW.endsAt.replace(" ", "T") },
        ],
      })
      .returning();
    await database.insert(schema.venueRequests).values({
      id: `vr-${crypto.randomUUID()}`,
      eventId: event.id,
      venueId: params.venue ?? venueId,
      requestedById: fixtureUsers.coordinator.id,
      assignedStaffId: fixtureUsers.coordinator.id,
      startsAt: WINDOW.startsAt,
      endsAt: WINDOW.endsAt,
      status: "approved",
    });
    const lineId = `er-${crypto.randomUUID()}`;
    await database.insert(schema.equipmentRequests).values({
      id: lineId,
      eventId: event.id,
      equipmentTypeId: typeId,
      quantity: params.requested ?? 3,
      assignedStaffId: params.assignedStaffId ?? null,
      item: typeName,
      arrangementStatus: "requested",
    });
    return { eventId: event.id, lineId };
  }

  async function reserve(lineId: string, quantity: number, actor: SessionUser = session("tech1")) {
    return handleReserveEquipment(
      { equipmentRequestId: lineId, quantity },
      actor,
      database as never
    );
  }

  async function readLine(lineId: string) {
    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, lineId));
    const [reservation] = await database
      .select()
      .from(schema.equipmentReservations)
      .where(eq(schema.equipmentReservations.equipmentRequestId, lineId));
    return { line, reservation };
  }

  async function notificationsFor(recipientId: string) {
    return database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.recipientId, recipientId));
  }

  beforeEach(async () => {
    await cleanup();
  });

  it("reduces a reservation to a new total and returns the line to requested (AC1)", async () => {
    const { lineId } = await createEvent({ name: "Reduce me", requested: 3 });
    await reserve(lineId, 3);
    expect((await readLine(lineId)).line.arrangementStatus).toBe("reserved");

    const result = await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 1 },
      session("tech1"),
      database as never
    );

    expect(result).toMatchObject({
      equipmentRequestId: lineId,
      previousQuantity: 3,
      quantity: 1,
      released: false,
      arrangementStatus: "requested",
    });
    const { line, reservation } = await readLine(lineId);
    expect(reservation.quantity).toBe(1);
    expect(line.arrangementStatus).toBe("requested");
    expect(line.unavailableReason).toBeNull();
    expect(line.lastReleasedQuantity).toBe(2);
    expect(line.lastReleasedByStaffId).toBe(fixtureUsers.tech1.id);
    expect(line.lastReleasedByStaffName).toBe(fixtureUsers.tech1.name);
    expect(line.lastReleasedAt).toBeInstanceOf(Date);
  });

  it("releases a reservation outright and removes the row (AC1)", async () => {
    const { lineId } = await createEvent({ name: "Release me", requested: 2 });
    await reserve(lineId, 2);

    const result = await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 0 },
      session("tech1"),
      database as never
    );

    expect(result).toMatchObject({ previousQuantity: 2, quantity: 0, released: true });
    const { line, reservation } = await readLine(lineId);
    expect(reservation).toBeUndefined();
    expect(line.arrangementStatus).toBe("requested");
    expect(line.lastReleasedQuantity).toBe(2);
    // The line stays with the member who released it, so it keeps its place on their list.
    expect(line.assignedStaffId).toBe(fixtureUsers.tech1.id);
  });

  it("marks the line unavailable with the reason given, and the DB keeps the pair (AC1)", async () => {
    const { lineId } = await createEvent({ name: "Unmet", requested: 4 });
    await reserve(lineId, 4);

    const result = await handleReleaseEquipment(
      {
        equipmentRequestId: lineId,
        quantity: 0,
        unavailableReason: "  Recalled by the supplier  ",
      },
      session("tech1"),
      database as never
    );

    expect(result.arrangementStatus).toBe("unavailable");
    const { line } = await readLine(lineId);
    expect(line.arrangementStatus).toBe("unavailable");
    expect(line.unavailableReason).toBe("Recalled by the supplier");
  });

  it("refuses a reason on a reduction, so an unavailable line never holds units", async () => {
    const { lineId } = await createEvent({ name: "No dead end", requested: 3 });
    await reserve(lineId, 3);

    await expect(
      handleReleaseEquipment(
        { equipmentRequestId: lineId, quantity: 1, unavailableReason: "Two recalled" },
        session("tech1"),
        database as never
      )
    ).rejects.toThrow(RELEASE_REASON_NEEDS_RELEASE_MESSAGE);
    const { line, reservation } = await readLine(lineId);
    expect(reservation.quantity).toBe(3);
    expect(line.arrangementStatus).toBe("reserved");
  });

  it("treats a whitespace-only reason as none: the line returns to requested", async () => {
    const { lineId } = await createEvent({ name: "Blank reason", requested: 2 });
    await reserve(lineId, 2);

    const result = await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 1, unavailableReason: " ​ " },
      session("tech1"),
      database as never
    );

    expect(result.arrangementStatus).toBe("requested");
    expect((await readLine(lineId)).line.unavailableReason).toBeNull();
  });

  it("makes the released quantity available to an overlapping event (AC2)", async () => {
    const holder = await createEvent({ name: "Holder", requested: 4 });
    const other = await createEvent({ name: "Other", requested: 3, venue: venueId2 });
    await reserve(holder.lineId, 4);
    const before = await handleCheckEquipmentAvailability(
      { eventId: other.eventId, equipmentTypeId: typeId, requestedQuantity: 3 },
      session("tech1"),
      database as never
    );
    expect(before.available).toBe(1);

    await handleReleaseEquipment(
      { equipmentRequestId: holder.lineId, quantity: 1 },
      session("tech1"),
      database as never
    );
    const afterReduce = await handleCheckEquipmentAvailability(
      { eventId: other.eventId, equipmentTypeId: typeId, requestedQuantity: 3 },
      session("tech1"),
      database as never
    );
    expect(afterReduce.available).toBe(4);

    await handleReleaseEquipment(
      { equipmentRequestId: holder.lineId, quantity: 0 },
      session("tech1"),
      database as never
    );
    const afterRelease = await handleCheckEquipmentAvailability(
      { eventId: other.eventId, equipmentTypeId: typeId, requestedQuantity: 3 },
      session("tech1"),
      database as never
    );
    expect(afterRelease.available).toBe(5);

    // And the other event can now take what was freed.
    const reserved = await reserve(other.lineId, 3);
    expect(reserved.arrangementStatus).toBe("reserved");
  });

  it("queues the assigned Coordinator's notification with the release (AC3)", async () => {
    const { eventId, lineId } = await createEvent({ name: "Notify me", requested: 2 });
    await reserve(lineId, 2);

    const result = await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 0 },
      session("tech1"),
      database as never
    );

    expect(result.notificationQueued).toBe(true);
    const rows = await notificationsFor(fixtureUsers.coordinator.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("equipment_released");
    expect(rows[0].eventRequestId).toBe(eventId);
    expect(rows[0].emailedAt).toBeNull();
    expect(rows[0].payload).toMatchObject({
      eventName: "Notify me",
      item: typeName,
      quantity: 0,
      previousQuantity: 2,
      unavailableReason: null,
    });
  });

  it("leaves no notification behind when the release is refused", async () => {
    const { lineId } = await createEvent({ name: "Refused", requested: 2 });
    await reserve(lineId, 2);

    await expect(
      handleReleaseEquipment(
        { equipmentRequestId: lineId, quantity: 2 },
        session("tech1"),
        database as never
      )
    ).rejects.toThrow(RELEASE_NOT_LOWER_MESSAGE);

    expect(await notificationsFor(fixtureUsers.coordinator.id)).toHaveLength(0);
    expect((await readLine(lineId)).reservation.quantity).toBe(2);
  });

  it("queues nothing when the event has no assigned Coordinator", async () => {
    const { lineId } = await createEvent({ name: "Nobody", requested: 2, coordinatorId: null });
    await reserve(lineId, 2);

    const result = await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 0 },
      session("tech1"),
      database as never
    );

    expect(result.notificationQueued).toBe(false);
    expect(await notificationsFor(fixtureUsers.coordinator.id)).toHaveLength(0);
  });

  // PTR-24 AC6: a release after confirmation is the Coordinator's to handle, not a status change.
  it("leaves a confirmed event confirmed (PTR-24 AC6)", async () => {
    const { eventId, lineId } = await createEvent({ name: "Already confirmed", requested: 2 });
    await reserve(lineId, 2);
    await database
      .update(schema.eventRequests)
      .set({
        status: "confirmed",
        confirmedById: fixtureUsers.coordinator.id,
        confirmedByName: fixtureUsers.coordinator.name,
        confirmedAt: new Date(),
      })
      .where(eq(schema.eventRequests.id, eventId));

    await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 0 },
      session("tech1"),
      database as never
    );

    const [event] = await database
      .select({ status: schema.eventRequests.status })
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, eventId));
    expect(event.status).toBe("confirmed");
  });

  it("leaves the event's status untouched (AC4)", async () => {
    const { eventId, lineId } = await createEvent({ name: "Still approved", requested: 2 });
    await reserve(lineId, 2);

    await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 0 },
      session("tech1"),
      database as never
    );

    const [event] = await database
      .select({ status: schema.eventRequests.status })
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, eventId));
    expect(event.status).toBe("approved");
    const projected = await handleListEvents(
      { eventId },
      session("coordinator"),
      database as never
    );
    expect(projected[0]?.event.status).toBe("approved");
    expect(projected[0]?.event.equipment?.[0]).toMatchObject({
      arrangementStatus: "requested",
      reservedQuantity: null,
      lastRelease: {
        quantity: 2,
        byName: fixtureUsers.tech1.name,
        at: expect.any(String),
      },
    });
    const organiserProjected = await handleListEvents(
      { eventId },
      session("organiser"),
      database as never
    );
    expect(organiserProjected[0]?.event.equipment?.[0]?.lastRelease).toBeUndefined();
  });

  it("refuses a total at or above the current holding, leaving it untouched", async () => {
    const { lineId } = await createEvent({ name: "Not lower", requested: 3 });
    await reserve(lineId, 2);

    await Promise.all(
      [2, 3].map(quantity =>
        expect(
          handleReleaseEquipment(
            { equipmentRequestId: lineId, quantity },
            session("tech1"),
            database as never
          )
        ).rejects.toMatchObject({ status: 409, message: RELEASE_NOT_LOWER_MESSAGE })
      )
    );
    expect((await readLine(lineId)).reservation.quantity).toBe(2);
  });

  it("refuses a line holding no reservation", async () => {
    const { lineId } = await createEvent({ name: "Nothing held", requested: 3 });

    await expect(
      handleReleaseEquipment(
        { equipmentRequestId: lineId, quantity: 0 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({ status: 409, message: RELEASE_NO_RESERVATION_MESSAGE });
  });

  it("refuses a member with no line on the event, and a colleague who holds another line", async () => {
    const { eventId, lineId } = await createEvent({ name: "Held by one", requested: 3 });
    await reserve(lineId, 3);

    // No line on the event at all: refused at the event gate.
    await expect(
      handleReleaseEquipment(
        { equipmentRequestId: lineId, quantity: 0 },
        session("tech2"),
        database as never
      )
    ).rejects.toMatchObject({ status: 403, message: "Forbidden" });

    // A colleague working a second line of the same event passes the event gate but not the
    // line's: tech1's holding is not theirs to give back.
    await database.insert(schema.equipmentRequests).values({
      id: `er-${crypto.randomUUID()}`,
      eventId,
      equipmentTypeId: typeId,
      quantity: 1,
      assignedStaffId: fixtureUsers.tech2.id,
      item: typeName,
      arrangementStatus: "requested",
    });
    await expect(
      handleReleaseEquipment(
        { equipmentRequestId: lineId, quantity: 0 },
        session("tech2"),
        database as never
      )
    ).rejects.toMatchObject({
      status: 403,
      message: "Equipment request is assigned to another staff member",
    });
    expect((await readLine(lineId)).reservation.quantity).toBe(3);
  });

  it("treats a missing line as not found", async () => {
    await expect(
      handleReleaseEquipment(
        { equipmentRequestId: "er-does-not-exist", quantity: 0 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  it("lets any member release a reserved line whose holder's account was deleted", async () => {
    const { eventId, lineId } = await createEvent({ name: "Holder gone", requested: 3 });
    await reserve(lineId, 3);

    // What the user FK's ON DELETE SET NULL leaves behind: a fully reserved, unassigned line.
    await database
      .update(schema.equipmentRequests)
      .set({ assignedStaffId: null })
      .where(eq(schema.equipmentRequests.id, lineId));

    // The event must still reach the queue the member's list is scoped by...
    const [projected] = await handleListEvents({ eventId }, session("tech2"), database as never);
    expect(projected?.event.equipment?.[0]).toMatchObject({
      id: lineId,
      arrangeable: true,
      reservedQuantity: 3,
    });

    // ...and its units must be releasable by a member who never held the line.
    const result = await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 0 },
      session("tech2"),
      database as never
    );
    expect(result.released).toBe(true);
    expect((await readLine(lineId)).reservation).toBeUndefined();
  });

  it("lets Technical Support move the line's state again once released", async () => {
    const { eventId, lineId } = await createEvent({ name: "Unlocked", requested: 2 });
    await reserve(lineId, 2);
    await handleReleaseEquipment(
      { equipmentRequestId: lineId, quantity: 0 },
      session("tech1"),
      database as never
    );

    const updated = await handleUpdateArrangement(
      { eventId, id: lineId, arrangementStatus: "not_required" },
      session("tech1"),
      database as never
    );
    expect(updated.arrangementStatus).toBe("not_required");
  });

  it("waits for the equipment type lock the reserve path holds, then frees the units", async () => {
    const holder = await createEvent({ name: "Holder race", requested: 5 });
    const other = await createEvent({ name: "Other race", requested: 3, venue: venueId2 });
    await reserve(holder.lineId, 5);
    await expect(reserve(other.lineId, 3)).rejects.toMatchObject({ status: 409 });

    // Hold the type row the way a reserve in flight does; the release must queue behind it.
    const blocker = await pool.connect();
    let released: { released: boolean } | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM equipment_types WHERE id = $1 FOR UPDATE", [typeId]);
      const pending = handleReleaseEquipment(
        { equipmentRequestId: holder.lineId, quantity: 0 },
        session("tech1"),
        database as never
      ).then(result => {
        released = result;
        return result;
      });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(released).toBeUndefined();
      expect((await readLine(holder.lineId)).reservation.quantity).toBe(5);

      await blocker.query("COMMIT");
      expect((await pending).released).toBe(true);
    } finally {
      blocker.release();
    }

    // With the lock gone and the units freed, the other event's reserve now succeeds.
    expect((await reserve(other.lineId, 3)).arrangementStatus).toBe("reserved");
  });
});
