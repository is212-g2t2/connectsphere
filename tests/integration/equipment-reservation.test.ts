// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleCheckLineAvailability,
  handleReserveEquipment,
} from "#/features/equipment-requests/reservations.server";
import { handleCheckEquipmentAvailability } from "#/features/equipment-requests/availability.server";
import {
  handleMapEquipmentLine,
  handleSaveEquipmentLine,
  handleUpdateArrangement,
} from "#/features/equipment-requests/equipment.server";
import {
  ARRANGEMENT_RESERVED_MESSAGE,
  EQUIPMENT_LINE_UNMAPPED_MESSAGE,
  EQUIPMENT_RESERVED_EDIT_MESSAGE,
} from "#/features/equipment-requests/schema";
import { handleListEvents } from "#/features/events/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const fixtureUsers = {
  tech1: {
    id: "eq-test-tech-1",
    name: "Tech Support One",
    email: "tech1@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
  tech2: {
    id: "eq-test-tech-2",
    name: "Tech Support Two",
    email: "tech2@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
  coordinator: {
    id: "eq-test-coord-1",
    name: "Coordinator One",
    email: "coord1@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  organiser: {
    id: "eq-test-org-1",
    name: "Organiser One",
    email: "org1@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
};

const session = (userKey: keyof typeof fixtureUsers): SessionUser => fixtureUsers[userKey];

describe("Equipment Reservation Integration (PTR-41)", () => {
  let pool: Pool;
  let database: Database;
  let testEquipmentTypeId: number;
  let testEquipmentTypeName: string;
  let fixtureVenueId: number;
  let fixtureVenueId2: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });

    // Remove stale test fixtures.
    await cleanup();

    // Insert fixture users in parallel.
    await Promise.all(
      Object.values(fixtureUsers).map(u =>
        database.insert(schema.user).values(u).onConflictDoNothing()
      )
    );

    // Insert two venues so concurrent events can use the same time.
    const [insertedVenue1, insertedVenue2] = await database
      .insert(schema.venues)
      .values([
        {
          name: `Equipment Test Hall 1 ${Date.now()}`,
          location: "Building E",
          maxCapacity: 200,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
        {
          name: `Equipment Test Hall 2 ${Date.now()}`,
          location: "Building F",
          maxCapacity: 100,
          operatingHours: DEFAULT_OPERATING_HOURS,
        },
      ])
      .returning({ id: schema.venues.id });

    fixtureVenueId = insertedVenue1.id;
    fixtureVenueId2 = insertedVenue2.id;

    // Insert a test equipment type with five units, one unavailable, and four serviceable.
    testEquipmentTypeName = `PTR41 Test Projector ${Date.now()}`;
    const [insertedType] = await database
      .insert(schema.equipmentTypes)
      .values({
        name: testEquipmentTypeName,
        quantityHeld: 5,
      })
      .returning({ id: schema.equipmentTypes.id });

    testEquipmentTypeId = insertedType.id;

    await database.insert(schema.equipmentUnavailability).values({
      equipmentTypeId: testEquipmentTypeId,
      quantityUnavailable: 1,
      reason: "Damaged bulb",
    });
  });

  afterAll(async () => {
    await cleanup();
    if (testEquipmentTypeId) {
      await database
        .delete(schema.equipmentUnavailability)
        .where(eq(schema.equipmentUnavailability.equipmentTypeId, testEquipmentTypeId));
      await database
        .delete(schema.equipmentTypes)
        .where(eq(schema.equipmentTypes.id, testEquipmentTypeId));
    }
    const venueIds = [fixtureVenueId, fixtureVenueId2].filter(
      (id): id is number => typeof id === "number"
    );
    if (venueIds.length > 0) {
      await database.delete(schema.venues).where(inArray(schema.venues.id, venueIds));
    }
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

    if (events.length > 0) {
      const eventIds = events.map(e => e.id);
      await database
        .delete(schema.equipmentReservations)
        .where(
          inArray(
            schema.equipmentReservations.equipmentRequestId,
            database
              .select({ id: schema.equipmentRequests.id })
              .from(schema.equipmentRequests)
              .where(inArray(schema.equipmentRequests.eventId, eventIds))
          )
        );
      await database
        .delete(schema.equipmentRequests)
        .where(inArray(schema.equipmentRequests.eventId, eventIds));
      await database
        .delete(schema.venueRequests)
        .where(inArray(schema.venueRequests.eventId, eventIds));
      await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, eventIds));
    }
  }

  async function createEventWithApprovedBooking(params: {
    name: string;
    startsAt: string;
    endsAt: string;
    venueId?: number;
    itemRequestedQuantity?: number;
    assignedStaffId?: string | null;
    equipmentTypeId?: number | null;
    item?: string;
    equipmentSubmitted?: boolean;
  }) {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.organiser.id,
        eventName: params.name,
        purpose: "PTR-41 Testing",
        status: "approved",
        assignedCoordinatorId: fixtureUsers.coordinator.id,
        assignedAt: new Date(),
        decidedByCoordinatorId: fixtureUsers.coordinator.id,
        decidedByCoordinatorName: fixtureUsers.coordinator.name,
        decidedAt: new Date(),
        submittedAt: new Date(),
        equipmentSubmittedAt: params.equipmentSubmitted === false ? null : new Date(),
        proposedDates: [
          { start: params.startsAt.replace(" ", "T"), end: params.endsAt.replace(" ", "T") },
        ],
      })
      .returning();

    const venueRequestId = `vr-${crypto.randomUUID()}`;
    await database.insert(schema.venueRequests).values({
      id: venueRequestId,
      eventId: event.id,
      venueId: params.venueId ?? fixtureVenueId,
      requestedById: fixtureUsers.coordinator.id,
      assignedStaffId: fixtureUsers.coordinator.id,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      status: "approved",
    });

    const equipmentRequestId = `er-${crypto.randomUUID()}`;
    await database.insert(schema.equipmentRequests).values({
      id: equipmentRequestId,
      eventId: event.id,
      equipmentTypeId:
        params.equipmentTypeId === undefined ? testEquipmentTypeId : params.equipmentTypeId,
      quantity: params.itemRequestedQuantity ?? 2,
      assignedStaffId: params.assignedStaffId ?? null,
      item: params.item ?? "PTR41 Test Projector",
      arrangementStatus: "requested",
    });

    return { eventId: event.id, venueRequestId, equipmentRequestId };
  }

  beforeEach(async () => {
    await cleanup();
  });

  it("records a reservation and marks arrangementStatus 'reserved' when reserved >= requested (AC1)", async () => {
    const { equipmentRequestId, venueRequestId } = await createEventWithApprovedBooking({
      name: "AC1 Event",
      startsAt: "2026-12-01 10:00:00",
      endsAt: "2026-12-01 14:00:00",
      itemRequestedQuantity: 2,
    });

    const result = await handleReserveEquipment(
      { equipmentRequestId, quantity: 2 },
      session("tech1"),
      database as never
    );

    expect(result.quantity).toBe(2);
    expect(result.arrangementStatus).toBe("reserved");
    expect(result.venueRequestId).toBe(venueRequestId);

    // Check the database state.
    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, equipmentRequestId));

    expect(line.arrangementStatus).toBe("reserved");
    expect(line.assignedStaffId).toBe(fixtureUsers.tech1.id);

    const [res] = await database
      .select()
      .from(schema.equipmentReservations)
      .where(eq(schema.equipmentReservations.equipmentRequestId, equipmentRequestId));

    expect(res).toBeDefined();
    expect(res.quantity).toBe(2);
    expect(res.equipmentTypeId).toBe(testEquipmentTypeId);
  });

  it("leaves arrangementStatus as 'requested' when reserved quantity is less than requested quantity (AC1 Note)", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "AC1 Note Partial Event",
      startsAt: "2026-12-02 10:00:00",
      endsAt: "2026-12-02 14:00:00",
      itemRequestedQuantity: 3,
    });

    const result = await handleReserveEquipment(
      { equipmentRequestId, quantity: 1 },
      session("tech1"),
      database as never
    );

    expect(result.quantity).toBe(1);
    expect(result.arrangementStatus).toBe("requested");

    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, equipmentRequestId));

    expect(line.arrangementStatus).toBe("requested");

    // Reserving all remaining units changes the line to `reserved`.
    const secondResult = await handleReserveEquipment(
      { equipmentRequestId, quantity: 3 },
      session("tech1"),
      database as never
    );

    expect(secondResult.quantity).toBe(3);
    expect(secondResult.arrangementStatus).toBe("reserved");
  });

  it("refuses reservation exceeding available inventory with 409 Conflict and states exact shortfall (AC2, PTR-40 AC3)", async () => {
    // Five units are held and one is unavailable, so four are available.
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "AC2 Over-allocation Event",
      startsAt: "2026-12-03 10:00:00",
      endsAt: "2026-12-03 14:00:00",
      itemRequestedQuantity: 5,
    });

    await expect(
      handleReserveEquipment(
        { equipmentRequestId, quantity: 5 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message:
        "Requested 5 units, but only 4 units are available for this period (shortfall of 1).",
    });
  });

  it("reduces available quantity for overlapping events by the reserved amount (AC3)", async () => {
    // Event 1 runs from 10:00 to 14:00.
    const event1 = await createEventWithApprovedBooking({
      name: "Overlapping Event 1",
      startsAt: "2026-12-04 10:00:00",
      endsAt: "2026-12-04 14:00:00",
      itemRequestedQuantity: 3,
    });

    // Event 2 runs from 12:00 to 16:00 and overlaps Event 1 from 12:00 to 14:00.
    const event2 = await createEventWithApprovedBooking({
      name: "Overlapping Event 2",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-04 12:00:00",
      endsAt: "2026-12-04 16:00:00",
      itemRequestedQuantity: 2,
    });

    // Event 1 reserves three of four units.
    await handleReserveEquipment(
      { equipmentRequestId: event1.equipmentRequestId, quantity: 3 },
      session("tech1"),
      database as never
    );

    // Event 2 requests two units during the overlap, when only one remains.
    await expect(
      handleReserveEquipment(
        { equipmentRequestId: event2.equipmentRequestId, quantity: 2 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: "Requested 2 units, but only 1 unit is available for this period (shortfall of 1).",
    });

    // Event 2 reserves the one remaining unit.
    const res2 = await handleReserveEquipment(
      { equipmentRequestId: event2.equipmentRequestId, quantity: 1 },
      session("tech1"),
      database as never
    );
    expect(res2.quantity).toBe(1);
  });

  it("shows reservation details and arrangement state when event is viewed (AC4)", async () => {
    const { equipmentRequestId, eventId } = await createEventWithApprovedBooking({
      name: "AC4 View Event",
      startsAt: "2026-12-05 10:00:00",
      endsAt: "2026-12-05 14:00:00",
      itemRequestedQuantity: 2,
      assignedStaffId: fixtureUsers.tech1.id,
    });

    await handleReserveEquipment(
      { equipmentRequestId, quantity: 2 },
      session("tech1"),
      database as never
    );

    const [projection] = await handleListEvents({ eventId }, session("tech1"), database as never);

    expect(projection.access).toBe("technical_support");
    expect(projection.event.equipment).toBeDefined();
    const item = projection.event.equipment?.find(e => e.id === equipmentRequestId);
    expect(item).toBeDefined();
    expect(item?.arrangementStatus).toBe("reserved");
    expect(item?.reservedQuantity).toBe(2);
  });

  it("never exceeds available quantity under concurrent overlapping reservations (AC5)", async () => {
    // Four units are serviceable. Events A and B both request three units for 10:00–14:00, so
    // both requests would require six units.
    const eventA = await createEventWithApprovedBooking({
      name: "Concurrent Event A",
      startsAt: "2026-12-06 10:00:00",
      endsAt: "2026-12-06 14:00:00",
      itemRequestedQuantity: 3,
    });

    const eventB = await createEventWithApprovedBooking({
      name: "Concurrent Event B",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-06 10:00:00",
      endsAt: "2026-12-06 14:00:00",
      itemRequestedQuantity: 3,
    });

    const results = await Promise.allSettled([
      handleReserveEquipment(
        { equipmentRequestId: eventA.equipmentRequestId, quantity: 3 },
        session("tech1"),
        database as never
      ),
      handleReserveEquipment(
        { equipmentRequestId: eventB.equipmentRequestId, quantity: 3 },
        session("tech2"),
        database as never
      ),
    ]);

    const successes = results.filter(r => r.status === "fulfilled");
    const rejections = results.filter(r => r.status === "rejected");

    // One request must succeed and one must be refused.
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    // Check the database invariant: three units are reserved, which is at most four.
    const activeReservations = await database
      .select({ quantity: schema.equipmentReservations.quantity })
      .from(schema.equipmentReservations)
      .where(
        inArray(schema.equipmentReservations.equipmentRequestId, [
          eventA.equipmentRequestId,
          eventB.equipmentRequestId,
        ])
      );

    const totalReserved = activeReservations.reduce((sum, r) => sum + r.quantity, 0);
    expect(totalReserved).toBe(3);
  });

  it("refuses reservation when event does not have an approved venue booking", async () => {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.organiser.id,
        eventName: "Unapproved Booking Event",
        purpose: "Testing gate",
        status: "submitted",
        submittedAt: new Date(),
        equipmentSubmittedAt: new Date(),
        proposedDates: [{ start: "2026-12-07T10:00", end: "2026-12-07T14:00" }],
      })
      .returning();

    // The venue request is pending, not approved.
    await database.insert(schema.venueRequests).values({
      id: `vr-pending-${crypto.randomUUID()}`,
      eventId: event.id,
      venueId: fixtureVenueId,
      requestedById: fixtureUsers.coordinator.id,
      startsAt: "2026-12-07 10:00:00",
      endsAt: "2026-12-07 14:00:00",
      status: "pending",
    });

    const equipmentRequestId = `er-unapproved-${crypto.randomUUID()}`;
    await database.insert(schema.equipmentRequests).values({
      id: equipmentRequestId,
      eventId: event.id,
      equipmentTypeId: testEquipmentTypeId,
      quantity: 1,
      item: "PTR41 Test Projector",
      arrangementStatus: "requested",
    });

    await expect(
      handleReserveEquipment(
        { equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: "Event must have an active approved venue booking before equipment can be reserved",
    });
  });

  it("refuses reservation when the actor has no workable line on the event", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Theft Protection Event",
      startsAt: "2026-12-08 10:00:00",
      endsAt: "2026-12-08 14:00:00",
      itemRequestedQuantity: 2,
      assignedStaffId: fixtureUsers.tech1.id,
    });

    // Tech 2 has no line on the event, so the queue check refuses before the line check.
    await expect(
      handleReserveEquipment(
        { equipmentRequestId, quantity: 1 },
        session("tech2"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "AuthorizationError",
      status: 403,
      message: "Forbidden",
    });
  });

  it("refuses a colleague's line even when the event is otherwise workable", async () => {
    const { eventId, equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Mixed Queue Event",
      startsAt: "2026-12-08 16:00:00",
      endsAt: "2026-12-08 18:00:00",
      itemRequestedQuantity: 2,
      assignedStaffId: fixtureUsers.tech1.id,
    });

    // Keep a second line unassigned so Tech 2 can access the event. The refusal must name the line.
    await database.insert(schema.equipmentRequests).values({
      id: `er-extra-${crypto.randomUUID()}`,
      eventId,
      equipmentTypeId: testEquipmentTypeId,
      quantity: 1,
      item: "PTR41 Test Projector",
      arrangementStatus: "requested",
    });

    await expect(
      handleReserveEquipment(
        { equipmentRequestId, quantity: 1 },
        session("tech2"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "AuthorizationError",
      status: 403,
      message: "Equipment request is assigned to another staff member",
    });
  });

  it("refuses an unassigned line before the equipment list is submitted", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Unsubmitted Event",
      startsAt: "2026-12-09 08:00:00",
      endsAt: "2026-12-09 10:00:00",
      equipmentSubmitted: false,
    });

    await expect(
      handleReserveEquipment(
        { equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "AuthorizationError",
      status: 403,
      message: "Forbidden",
    });
  });

  it("requires a booking choice when the event has several active bookings", async () => {
    const { eventId, equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Two Bookings Event",
      startsAt: "2026-12-09 10:00:00",
      endsAt: "2026-12-09 12:00:00",
    });

    // A second approved booking leaves the reservation period ambiguous. Refuse the reservation.
    await database.insert(schema.venueRequests).values({
      id: `vr-second-${crypto.randomUUID()}`,
      eventId,
      venueId: fixtureVenueId2,
      requestedById: fixtureUsers.coordinator.id,
      startsAt: "2026-12-09 14:00:00",
      endsAt: "2026-12-09 16:00:00",
      status: "approved",
    });

    await expect(
      handleReserveEquipment(
        { equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: "Choose an active approved venue booking for this line",
    });
    expect(
      await database
        .select()
        .from(schema.equipmentReservations)
        .where(eq(schema.equipmentReservations.equipmentRequestId, equipmentRequestId))
    ).toEqual([]);
    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, equipmentRequestId));
    expect(line).toMatchObject({ arrangementStatus: "requested", assignedStaffId: null });
  });

  it("requires a choice if another booking is approved while reserve waits for the venue", async () => {
    const target = await createEventWithApprovedBooking({
      name: "Concurrent session approval",
      startsAt: "2030-02-04 10:00:00",
      endsAt: "2030-02-04 12:00:00",
    });
    const gate = await pool.connect();
    await gate.query("select pg_advisory_lock($1::bigint)", [fixtureVenueId]);
    const [{ pid }] = (await gate.query<{ pid: number }>("select pg_backend_pid() as pid")).rows;
    const attempt = handleReserveEquipment(
      { equipmentRequestId: target.equipmentRequestId, quantity: 1 },
      session("tech1"),
      database as never
    ).then(
      value => ({ value }),
      (error: unknown) => ({ error })
    );
    try {
      await expect
        .poll(
          async () => {
            const result = await pool.query<{ waiting: number }>(
              "select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and $1::int = any(pg_blocking_pids(pid))",
              [pid]
            );
            return result.rows[0].waiting;
          },
          { timeout: 5000 }
        )
        .toBeGreaterThan(0);
      await database.insert(schema.venueRequests).values({
        id: `vr-${crypto.randomUUID()}`,
        eventId: target.eventId,
        venueId: fixtureVenueId2,
        requestedById: fixtureUsers.coordinator.id,
        startsAt: "2030-02-04 14:00:00",
        endsAt: "2030-02-04 16:00:00",
        status: "approved",
      });
    } finally {
      await gate.query("select pg_advisory_unlock($1::bigint)", [fixtureVenueId]);
      gate.release();
    }
    expect(await attempt).toMatchObject({
      error: { message: "Choose an active approved venue booking for this line" },
    });
    expect(
      await database
        .select()
        .from(schema.equipmentReservations)
        .where(eq(schema.equipmentReservations.equipmentRequestId, target.equipmentRequestId))
    ).toEqual([]);
    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, target.equipmentRequestId));
    expect(line).toMatchObject({ arrangementStatus: "requested", assignedStaffId: null });
  });

  it("refuses when the sole active booking changes while reserve waits for the venue", async () => {
    const target = await createEventWithApprovedBooking({
      name: "Concurrent session swap",
      startsAt: "2030-02-04 10:00:00",
      endsAt: "2030-02-04 12:00:00",
    });
    await database.insert(schema.venueOccupancy).values({
      venueRequestId: target.venueRequestId,
      eventId: target.eventId,
      venueId: fixtureVenueId,
      startsAt: "2030-02-04 10:00:00",
      endsAt: "2030-02-04 12:00:00",
      active: true,
    });
    const gate = await pool.connect();
    await gate.query("select pg_advisory_lock($1::bigint)", [fixtureVenueId]);
    const [{ pid }] = (await gate.query<{ pid: number }>("select pg_backend_pid() as pid")).rows;
    const attempt = handleReserveEquipment(
      { equipmentRequestId: target.equipmentRequestId, quantity: 1 },
      session("tech1"),
      database as never
    ).then(
      value => ({ value }),
      (error: unknown) => ({ error })
    );
    try {
      await expect
        .poll(
          async () => {
            const result = await pool.query<{ waiting: number }>(
              "select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and $1::int = any(pg_blocking_pids(pid))",
              [pid]
            );
            return result.rows[0].waiting;
          },
          { timeout: 5000 }
        )
        .toBeGreaterThan(0);
      // Swap the sole active booking while the reserve waits. The re-read meets the new choice.
      await database.insert(schema.venueRequests).values({
        id: `vr-${crypto.randomUUID()}`,
        eventId: target.eventId,
        venueId: fixtureVenueId2,
        requestedById: fixtureUsers.coordinator.id,
        startsAt: "2030-02-04 14:00:00",
        endsAt: "2030-02-04 16:00:00",
        status: "approved",
      });
      await database
        .update(schema.venueOccupancy)
        .set({ active: false })
        .where(eq(schema.venueOccupancy.venueRequestId, target.venueRequestId));
    } finally {
      await gate.query("select pg_advisory_unlock($1::bigint)", [fixtureVenueId]);
      gate.release();
    }
    expect(await attempt).toMatchObject({
      error: { message: "The venue booking changed. Try again." },
    });
    expect(
      await database
        .select()
        .from(schema.equipmentReservations)
        .where(eq(schema.equipmentReservations.equipmentRequestId, target.equipmentRequestId))
    ).toEqual([]);
    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, target.equipmentRequestId));
    expect(line).toMatchObject({ arrangementStatus: "requested", assignedStaffId: null });
  });

  it("uses the chosen session's stored buffers across both checks and reservation", async () => {
    const target = await createEventWithApprovedBooking({
      name: "Session windows",
      startsAt: "2030-02-01 10:00:00",
      endsAt: "2030-02-01 12:00:00",
      itemRequestedQuantity: 4,
    });
    const secondId = `vr-${crypto.randomUUID()}`;
    await database.insert(schema.venueRequests).values({
      id: secondId,
      eventId: target.eventId,
      venueId: fixtureVenueId,
      requestedById: fixtureUsers.coordinator.id,
      startsAt: "2030-02-01 15:00:00",
      endsAt: "2030-02-01 17:00:00",
      status: "approved",
    });
    await database.insert(schema.venueOccupancy).values([
      {
        venueRequestId: target.venueRequestId,
        eventId: target.eventId,
        venueId: fixtureVenueId,
        startsAt: "2030-02-01 10:00:00",
        endsAt: "2030-02-01 12:00:00",
        setupMinutes: 30,
        turnaroundMinutes: 45,
      },
      {
        venueRequestId: secondId,
        eventId: target.eventId,
        venueId: fixtureVenueId,
        startsAt: "2030-02-01 15:00:00",
        endsAt: "2030-02-01 17:00:00",
        setupMinutes: 30,
        turnaroundMinutes: 45,
      },
    ]);
    const competitor = await createEventWithApprovedBooking({
      name: "Setup competitor",
      startsAt: "2030-02-01 09:00:00",
      endsAt: "2030-02-01 09:45:00",
      venueId: fixtureVenueId2,
    });
    await handleReserveEquipment(
      { equipmentRequestId: competitor.equipmentRequestId, quantity: 2 },
      session("tech2"),
      database as never
    );
    const input = {
      equipmentRequestId: target.equipmentRequestId,
      venueRequestId: target.venueRequestId,
    };
    expect(await handleCheckLineAvailability(input, session("tech1"), database as never)).toEqual({
      availableQuantity: 2,
      period: { startsAt: "2030-02-01T09:30", endsAt: "2030-02-01T12:45" },
    });
    expect(
      await handleCheckEquipmentAvailability(
        {
          eventId: target.eventId,
          equipmentTypeId: testEquipmentTypeId,
          venueRequestId: target.venueRequestId,
        },
        session("tech1"),
        database as never
      )
    ).toMatchObject({ available: 2 });
    await expect(
      handleReserveEquipment({ ...input, quantity: 3 }, session("tech1"), database as never)
    ).rejects.toThrow("shortfall of 1");
    await handleReserveEquipment({ ...input, quantity: 2 }, session("tech1"), database as never);
    const [reservation] = await database
      .select()
      .from(schema.equipmentReservations)
      .where(eq(schema.equipmentReservations.equipmentRequestId, target.equipmentRequestId));
    expect(reservation).toMatchObject({
      venueRequestId: target.venueRequestId,
      startsAt: "2030-02-01 09:30:00",
      endsAt: "2030-02-01 12:45:00",
    });
    expect(
      await handleCheckLineAvailability(
        { ...input, venueRequestId: secondId },
        session("tech1"),
        database as never
      )
    ).toMatchObject({
      availableQuantity: 4,
      period: { startsAt: "2030-02-01T14:30", endsAt: "2030-02-01T17:45" },
    });
    expect(
      await handleCheckEquipmentAvailability(
        { eventId: target.eventId, equipmentTypeId: testEquipmentTypeId, venueRequestId: secondId },
        session("tech1"),
        database as never
      )
    ).toMatchObject({ available: 4 });
    await handleReserveEquipment(
      { ...input, venueRequestId: secondId, quantity: 4 },
      session("tech1"),
      database as never
    );
    expect(
      await handleCheckEquipmentAvailability(
        {
          eventId: target.eventId,
          equipmentTypeId: testEquipmentTypeId,
          venueRequestId: target.venueRequestId,
        },
        session("tech1"),
        database as never
      )
    ).toMatchObject({ available: 2 });
  });

  it("spans both pieces of a split booking when reading the period", async () => {
    const target = await createEventWithApprovedBooking({
      name: "Split Pieces Event",
      startsAt: "2030-02-05 15:00:00",
      endsAt: "2030-02-05 17:00:00",
    });
    await database.insert(schema.venueOccupancy).values([
      {
        venueRequestId: target.venueRequestId,
        eventId: target.eventId,
        venueId: fixtureVenueId,
        startsAt: "2030-02-05 15:00:00",
        endsAt: "2030-02-05 16:00:00",
        setupMinutes: 30,
        turnaroundMinutes: 0,
      },
      {
        venueRequestId: target.venueRequestId,
        eventId: target.eventId,
        venueId: fixtureVenueId,
        startsAt: "2030-02-05 16:00:00",
        endsAt: "2030-02-05 17:00:00",
        setupMinutes: 0,
        turnaroundMinutes: 45,
      },
    ]);

    await expect(
      handleCheckEquipmentAvailability(
        { eventId: target.eventId, equipmentTypeId: testEquipmentTypeId },
        session("tech1"),
        database as never
      )
    ).resolves.toMatchObject({
      period: { startsAt: "2030-02-05T14:30", endsAt: "2030-02-05T17:45" },
    });

    await handleReserveEquipment(
      { equipmentRequestId: target.equipmentRequestId, quantity: 1 },
      session("tech1"),
      database as never
    );
    const [reservation] = await database
      .select()
      .from(schema.equipmentReservations)
      .where(eq(schema.equipmentReservations.equipmentRequestId, target.equipmentRequestId));
    expect(reservation).toMatchObject({
      startsAt: "2030-02-05 14:30:00",
      endsAt: "2030-02-05 17:45:00",
    });
  });

  it("falls back to the venue buffers when the booking has no ledger rows", async () => {
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: `Buffered Venue ${crypto.randomUUID()}`,
        location: "Building E",
        maxCapacity: 200,
        setupMinutes: 20,
        turnaroundMinutes: 40,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    const target = await createEventWithApprovedBooking({
      name: "Fallback Buffers Event",
      startsAt: "2030-02-06 10:00:00",
      endsAt: "2030-02-06 12:00:00",
      venueId: venue.id,
    });
    try {
      await expect(
        handleCheckEquipmentAvailability(
          { eventId: target.eventId, equipmentTypeId: testEquipmentTypeId },
          session("tech1"),
          database as never
        )
      ).resolves.toMatchObject({
        period: { startsAt: "2030-02-06T09:40", endsAt: "2030-02-06T12:40" },
      });

      await handleReserveEquipment(
        { equipmentRequestId: target.equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      );
      const [reservation] = await database
        .select()
        .from(schema.equipmentReservations)
        .where(eq(schema.equipmentReservations.equipmentRequestId, target.equipmentRequestId));
      expect(reservation).toMatchObject({
        startsAt: "2030-02-06 09:40:00",
        endsAt: "2030-02-06 12:40:00",
      });
    } finally {
      await database
        .delete(schema.eventRequests)
        .where(eq(schema.eventRequests.id, target.eventId));
      await database.delete(schema.venues).where(eq(schema.venues.id, venue.id));
    }
  });

  it("excludes a partially suspended booking and refuses foreign and released targets", async () => {
    const target = await createEventWithApprovedBooking({
      name: "Suspended session",
      startsAt: "2030-02-02 10:00:00",
      endsAt: "2030-02-02 12:00:00",
    });
    await database.insert(schema.venueOccupancy).values([
      {
        venueRequestId: target.venueRequestId,
        eventId: target.eventId,
        venueId: fixtureVenueId,
        startsAt: "2030-02-02 10:00:00",
        endsAt: "2030-02-02 11:00:00",
        active: true,
      },
      {
        venueRequestId: target.venueRequestId,
        eventId: target.eventId,
        venueId: fixtureVenueId,
        startsAt: "2030-02-02 11:00:00",
        endsAt: "2030-02-02 12:00:00",
        active: false,
      },
    ]);
    const input = {
      equipmentRequestId: target.equipmentRequestId,
      venueRequestId: target.venueRequestId,
    };
    await expect(
      handleReserveEquipment({ ...input, quantity: 1 }, session("tech1"), database as never)
    ).rejects.toThrow("approved venue booking");
    await expect(
      handleCheckLineAvailability(input, session("tech1"), database as never)
    ).rejects.toThrow("approved venue booking");
    await expect(
      handleCheckEquipmentAvailability(
        {
          eventId: target.eventId,
          equipmentTypeId: testEquipmentTypeId,
          venueRequestId: target.venueRequestId,
        },
        session("tech1"),
        database as never
      )
    ).rejects.toThrow("approved venue booking");
    const [projection] = await handleListEvents(
      { eventId: target.eventId },
      session("tech1"),
      database as never
    );
    expect(projection.event.equipmentBookings).toEqual([]);
    await database
      .update(schema.venueOccupancy)
      .set({ active: true })
      .where(eq(schema.venueOccupancy.venueRequestId, target.venueRequestId));
    await expect(
      handleReserveEquipment(
        { ...input, venueRequestId: "another-event", quantity: 1 },
        session("tech1"),
        database as never
      )
    ).rejects.toThrow("Choose an active");
    await database
      .update(schema.venueRequests)
      .set({ status: "released", releaseReason: "Test" })
      .where(eq(schema.venueRequests.id, target.venueRequestId));
    await expect(
      handleReserveEquipment({ ...input, quantity: 1 }, session("tech1"), database as never)
    ).rejects.toThrow("approved venue booking");
    expect(
      await database
        .select()
        .from(schema.equipmentReservations)
        .where(eq(schema.equipmentReservations.equipmentRequestId, target.equipmentRequestId))
    ).toEqual([]);
  });

  it("derives Window changed on read without changing the holding or sending a notice", async () => {
    const target = await createEventWithApprovedBooking({
      name: "Changed session",
      startsAt: "2030-02-03 10:00:00",
      endsAt: "2030-02-03 12:00:00",
    });
    await handleReserveEquipment(
      { equipmentRequestId: target.equipmentRequestId, quantity: 2 },
      session("tech1"),
      database as never
    );
    const read = async (actor: SessionUser) =>
      (await handleListEvents({ eventId: target.eventId }, actor, database as never))[0].event
        .equipment?.[0];
    expect(await read(session("tech1"))).toMatchObject({ windowChanged: false });
    const noticesBefore = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, target.eventId));
    await database
      .update(schema.venueRequests)
      .set({ endsAt: "2030-02-03 13:00:00" })
      .where(eq(schema.venueRequests.id, target.venueRequestId));
    const projections = await Promise.all([session("tech1"), session("coordinator")].map(read));
    for (const projection of projections) {
      expect(projection).toMatchObject({
        windowChanged: true,
        reservedQuantity: 2,
        arrangementStatus: "reserved",
      });
    }
    await handleReserveEquipment(
      { equipmentRequestId: target.equipmentRequestId, quantity: 2 },
      session("tech1"),
      database as never
    );
    expect(await read(session("tech1"))).toMatchObject({ windowChanged: false });
    await database
      .update(schema.venueRequests)
      .set({ status: "released", releaseReason: "Test" })
      .where(eq(schema.venueRequests.id, target.venueRequestId));
    expect(await read(session("coordinator"))).toMatchObject({
      windowChanged: true,
      reservedQuantity: 2,
    });
    expect(
      await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.eventRequestId, target.eventId))
    ).toEqual(noticesBefore);
  });

  it("refuses an unmapped line even when its item matches a catalogue name", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Name Match Event",
      startsAt: "2026-12-10 10:00:00",
      endsAt: "2026-12-10 12:00:00",
      itemRequestedQuantity: 1,
      equipmentTypeId: null,
      item: testEquipmentTypeName,
    });

    await expect(
      handleReserveEquipment(
        { equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: EQUIPMENT_LINE_UNMAPPED_MESSAGE,
    });
  });

  it("reserves once the line is mapped to a type (PTR-162 AC5)", async () => {
    const { eventId, equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Mapped Line Event",
      startsAt: "2026-12-10 10:00:00",
      endsAt: "2026-12-10 12:00:00",
      itemRequestedQuantity: 1,
      equipmentTypeId: null,
      item: testEquipmentTypeName,
    });

    await handleMapEquipmentLine(
      { eventId, id: equipmentRequestId, equipmentTypeId: testEquipmentTypeId },
      session("tech1"),
      database as never
    );
    const result = await handleReserveEquipment(
      { equipmentRequestId, quantity: 1 },
      session("tech1"),
      database as never
    );
    expect(result.arrangementStatus).toBe("reserved");

    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, equipmentRequestId));
    expect(line.equipmentTypeId).toBe(testEquipmentTypeId);
  });

  it("refuses an unmapped line whose item matches no type without a name lookup error", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Name Miss Event",
      startsAt: "2026-12-10 14:00:00",
      endsAt: "2026-12-10 16:00:00",
      itemRequestedQuantity: 1,
      equipmentTypeId: null,
      item: "Unregistered Fog Machine",
    });

    await expect(
      handleReserveEquipment(
        { equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: EQUIPMENT_LINE_UNMAPPED_MESSAGE,
    });
  });

  it("treats back-to-back bookings as non-overlapping", async () => {
    // Four units are serviceable. These periods only touch, so each event can use all four.
    const first = await createEventWithApprovedBooking({
      name: "Touching First",
      startsAt: "2026-12-13 10:00:00",
      endsAt: "2026-12-13 12:00:00",
      itemRequestedQuantity: 4,
    });
    const second = await createEventWithApprovedBooking({
      name: "Touching Second",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-13 12:00:00",
      endsAt: "2026-12-13 14:00:00",
      itemRequestedQuantity: 4,
    });

    await expect(
      handleReserveEquipment(
        { equipmentRequestId: first.equipmentRequestId, quantity: 4 },
        session("tech1"),
        database as never
      )
    ).resolves.toMatchObject({ quantity: 4 });
    await expect(
      handleReserveEquipment(
        { equipmentRequestId: second.equipmentRequestId, quantity: 4 },
        session("tech1"),
        database as never
      )
    ).resolves.toMatchObject({ quantity: 4 });
  });

  it("counts a competing event's reservation once: the stored period overlaps once", async () => {
    // The competing event snapshots its 10:00–12:00 booking. Add a second approved booking later.
    // The reservation still counts once, using three of four units, so the target has one free unit.
    const competitor = await createEventWithApprovedBooking({
      name: "Fan-out Competitor",
      startsAt: "2026-12-15 10:00:00",
      endsAt: "2026-12-15 12:00:00",
      itemRequestedQuantity: 3,
    });

    await handleReserveEquipment(
      { equipmentRequestId: competitor.equipmentRequestId, quantity: 3 },
      session("tech1"),
      database as never
    );

    await database.insert(schema.venueRequests).values({
      id: `vr-fanout-${crypto.randomUUID()}`,
      eventId: competitor.eventId,
      venueId: fixtureVenueId,
      requestedById: fixtureUsers.coordinator.id,
      startsAt: "2026-12-15 12:00:00",
      endsAt: "2026-12-15 14:00:00",
      status: "approved",
    });

    const target = await createEventWithApprovedBooking({
      name: "Fan-out Target",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-15 11:00:00",
      endsAt: "2026-12-15 13:00:00",
      itemRequestedQuantity: 1,
    });

    const accepted = await handleReserveEquipment(
      { equipmentRequestId: target.equipmentRequestId, quantity: 1 },
      session("tech1"),
      database as never
    );
    expect(accepted.quantity).toBe(1);
  });

  it("counts the peak concurrent commitment, not the sum, for staggered windows", async () => {
    // Two non-overlapping reservations (10:00–12:00 and 12:00–14:00) each use three of four units.
    // A third event from 11:00 to 13:00 sees a peak of three, so one unit is free. Summing both
    // reservations would report no free units.
    const morning = await createEventWithApprovedBooking({
      name: "Staggered Morning",
      startsAt: "2026-12-14 10:00:00",
      endsAt: "2026-12-14 12:00:00",
      itemRequestedQuantity: 3,
    });
    const afternoon = await createEventWithApprovedBooking({
      name: "Staggered Afternoon",
      startsAt: "2026-12-14 12:00:00",
      endsAt: "2026-12-14 14:00:00",
      itemRequestedQuantity: 3,
    });
    const spanning = await createEventWithApprovedBooking({
      name: "Staggered Spanning",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-14 11:00:00",
      endsAt: "2026-12-14 13:00:00",
      itemRequestedQuantity: 2,
    });

    await handleReserveEquipment(
      { equipmentRequestId: morning.equipmentRequestId, quantity: 3 },
      session("tech1"),
      database as never
    );
    await handleReserveEquipment(
      { equipmentRequestId: afternoon.equipmentRequestId, quantity: 3 },
      session("tech1"),
      database as never
    );

    await expect(
      handleReserveEquipment(
        { equipmentRequestId: spanning.equipmentRequestId, quantity: 2 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({ name: "ConflictError", status: 409 });

    const accepted = await handleReserveEquipment(
      { equipmentRequestId: spanning.equipmentRequestId, quantity: 1 },
      session("tech1"),
      database as never
    );
    expect(accepted.quantity).toBe(1);
  });

  it("snapshots the booking window on the reservation", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Snapshot Event",
      startsAt: "2026-12-21 10:00:00",
      endsAt: "2026-12-21 14:00:00",
      itemRequestedQuantity: 2,
    });

    await handleReserveEquipment(
      { equipmentRequestId, quantity: 2 },
      session("tech1"),
      database as never
    );

    const [res] = await database
      .select()
      .from(schema.equipmentReservations)
      .where(eq(schema.equipmentReservations.equipmentRequestId, equipmentRequestId));

    expect(res.startsAt).toContain("10:00");
    expect(res.endsAt).toContain("14:00");
  });

  it.each(["unavailable", "not_required"] as const)(
    "refuses to reserve a line marked %s",
    async status => {
      // Assign the event to the actor so the queue check passes and the state check runs.
      const { equipmentRequestId } = await createEventWithApprovedBooking({
        name: `State Gate ${status}`,
        startsAt: "2026-12-22 10:00:00",
        endsAt: "2026-12-22 14:00:00",
        itemRequestedQuantity: 2,
        assignedStaffId: fixtureUsers.tech1.id,
      });
      await database
        .update(schema.equipmentRequests)
        .set({
          arrangementStatus: status,
          unavailableReason: status === "unavailable" ? "Broken beyond repair" : null,
        })
        .where(eq(schema.equipmentRequests.id, equipmentRequestId));

      await expect(
        handleReserveEquipment(
          { equipmentRequestId, quantity: 1 },
          session("tech1"),
          database as never
        )
      ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
    }
  );

  it("an amended booking does not move the reservation until it is re-reserved", async () => {
    const first = await createEventWithApprovedBooking({
      name: "Amended First",
      startsAt: "2026-12-23 10:00:00",
      endsAt: "2026-12-23 14:00:00",
      itemRequestedQuantity: 4,
    });
    await handleReserveEquipment(
      { equipmentRequestId: first.equipmentRequestId, quantity: 4 },
      session("tech1"),
      database as never
    );

    await database
      .update(schema.venueRequests)
      .set({ startsAt: "2026-12-23 16:00:00", endsAt: "2026-12-23 18:00:00" })
      .where(eq(schema.venueRequests.eventId, first.eventId));

    // The snapshot still uses the morning window, so a competing event finds no free units then.
    const rival = await createEventWithApprovedBooking({
      name: "Amended Rival",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-23 10:00:00",
      endsAt: "2026-12-23 14:00:00",
      itemRequestedQuantity: 4,
    });
    await expect(
      handleReserveEquipment(
        { equipmentRequestId: rival.equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({ name: "ConflictError", status: 409 });

    // Re-reservation uses the amended booking and frees the morning period.
    await handleReserveEquipment(
      { equipmentRequestId: first.equipmentRequestId, quantity: 4 },
      session("tech1"),
      database as never
    );
    const [res] = await database
      .select()
      .from(schema.equipmentReservations)
      .where(eq(schema.equipmentReservations.equipmentRequestId, first.equipmentRequestId));
    expect(res.startsAt).toContain("16:00");

    await expect(
      handleReserveEquipment(
        { equipmentRequestId: rival.equipmentRequestId, quantity: 4 },
        session("tech1"),
        database as never
      )
    ).resolves.toMatchObject({ quantity: 4 });
  });

  it("a released booking keeps the reservation counted", async () => {
    const first = await createEventWithApprovedBooking({
      name: "Released First",
      startsAt: "2026-12-24 10:00:00",
      endsAt: "2026-12-24 14:00:00",
      itemRequestedQuantity: 4,
    });
    await handleReserveEquipment(
      { equipmentRequestId: first.equipmentRequestId, quantity: 4 },
      session("tech1"),
      database as never
    );

    await database
      .update(schema.venueRequests)
      .set({ status: "released", releaseReason: "Test" })
      .where(eq(schema.venueRequests.eventId, first.eventId));

    const rival = await createEventWithApprovedBooking({
      name: "Released Rival",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-24 10:00:00",
      endsAt: "2026-12-24 14:00:00",
      itemRequestedQuantity: 1,
    });
    await expect(
      handleReserveEquipment(
        { equipmentRequestId: rival.equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
  });

  it("concurrent re-reserves of the same line leave one consistent row", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Same Line Race",
      startsAt: "2026-12-25 10:00:00",
      endsAt: "2026-12-25 14:00:00",
      itemRequestedQuantity: 2,
    });

    const results = await Promise.allSettled([
      handleReserveEquipment(
        { equipmentRequestId, quantity: 1 },
        session("tech1"),
        database as never
      ),
      handleReserveEquipment(
        { equipmentRequestId, quantity: 2 },
        session("tech1"),
        database as never
      ),
    ]);

    expect(results.every(r => r.status === "fulfilled")).toBe(true);

    const rows = await database
      .select()
      .from(schema.equipmentReservations)
      .where(eq(schema.equipmentReservations.equipmentRequestId, equipmentRequestId));
    expect(rows).toHaveLength(1);

    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, equipmentRequestId));
    expect(line.arrangementStatus).toBe(rows[0].quantity >= 2 ? "reserved" : "requested");
  });

  it("reports the line's free quantity for its booking window", async () => {
    // Five units are held, one is unavailable, and four are serviceable. Nothing is reserved yet.
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Check Number Event",
      startsAt: "2026-12-26 10:00:00",
      endsAt: "2026-12-26 14:00:00",
      itemRequestedQuantity: 2,
    });

    await expect(
      handleCheckLineAvailability({ equipmentRequestId }, session("tech1"), database as never)
    ).resolves.toEqual({
      availableQuantity: 4,
      period: { startsAt: "2026-12-26T10:00", endsAt: "2026-12-26T14:00" },
    });
  });

  it("leaves the line's own reservation out of its free quantity", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Check Self Event",
      startsAt: "2026-12-26 10:00:00",
      endsAt: "2026-12-26 14:00:00",
      itemRequestedQuantity: 2,
    });

    await handleReserveEquipment(
      { equipmentRequestId, quantity: 2 },
      session("tech1"),
      database as never
    );

    // Two of four units are assigned to this line. Do not count the line against itself.
    await expect(
      handleCheckLineAvailability({ equipmentRequestId }, session("tech1"), database as never)
    ).resolves.toEqual({
      availableQuantity: 4,
      period: { startsAt: "2026-12-26T10:00", endsAt: "2026-12-26T14:00" },
    });
  });

  it.each([
    ["unavailable", "Unavailable"],
    ["not_required", "Not required"],
  ] as const)(
    "refuses to check a line marked %s, like the reserve submit",
    async (status, label) => {
      const { equipmentRequestId } = await createEventWithApprovedBooking({
        name: `Check State Gate ${status}`,
        startsAt: "2026-12-27 10:00:00",
        endsAt: "2026-12-27 14:00:00",
        itemRequestedQuantity: 2,
        assignedStaffId: fixtureUsers.tech1.id,
      });
      await database
        .update(schema.equipmentRequests)
        .set({
          arrangementStatus: status,
          unavailableReason: status === "unavailable" ? "Broken beyond repair" : null,
        })
        .where(eq(schema.equipmentRequests.id, equipmentRequestId));

      await expect(
        handleCheckLineAvailability({ equipmentRequestId }, session("tech1"), database as never)
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: `Cannot reserve equipment for a line marked "${label}"`,
      });
    }
  );

  it("refuses a state change on a partially reserved line but still allows notes", async () => {
    // A partial reservation keeps the line `requested`. The row below reserves one of three units
    // without changing the status, so only the reservation guard can see it.
    const { eventId, equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Partial Freeze Event",
      startsAt: "2026-12-28 10:00:00",
      endsAt: "2026-12-28 14:00:00",
      itemRequestedQuantity: 3,
    });
    await database.insert(schema.equipmentReservations).values({
      id: `eq-res-${crypto.randomUUID()}`,
      equipmentRequestId,
      equipmentTypeId: testEquipmentTypeId,
      quantity: 1,
      startsAt: "2026-12-28 10:00:00",
      endsAt: "2026-12-28 14:00:00",
    });

    await expect(
      handleUpdateArrangement(
        {
          eventId,
          id: equipmentRequestId,
          arrangementStatus: "unavailable",
          unavailableReason: "Loaned out",
        },
        session("tech1"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: ARRANGEMENT_RESERVED_MESSAGE,
    });

    await handleUpdateArrangement(
      { eventId, id: equipmentRequestId, arrangementNotes: "Collect from store B" },
      session("tech1"),
      database as never
    );

    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, equipmentRequestId));
    expect(line.arrangementStatus).toBe("requested");
    expect(line.arrangementNotes).toBe("Collect from store B");
  });

  it("refuses a coordinator edit on a line holding a reservation", async () => {
    const { eventId, equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Edit Freeze Event",
      startsAt: "2026-12-29 10:00:00",
      endsAt: "2026-12-29 14:00:00",
      itemRequestedQuantity: 2,
      equipmentSubmitted: false,
    });
    await database.insert(schema.equipmentReservations).values({
      id: `eq-res-${crypto.randomUUID()}`,
      equipmentRequestId,
      equipmentTypeId: testEquipmentTypeId,
      quantity: 1,
      startsAt: "2026-12-29 10:00:00",
      endsAt: "2026-12-29 14:00:00",
    });

    await expect(
      handleSaveEquipmentLine(
        {
          eventId,
          id: equipmentRequestId,
          item: "PTR41 Test Projector",
          quantity: 5,
        },
        session("coordinator"),
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: EQUIPMENT_RESERVED_EDIT_MESSAGE,
    });

    const [line] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, equipmentRequestId));
    expect(line.quantity).toBe(2);
  });

  it("reduces the availability check for an overlapping event once a reservation is recorded (AC3 record → check)", async () => {
    // Five units are held, one is unavailable, and four are serviceable. The first event reserves
    // three. The overlapping event reads the reduced availability through the check handler.
    const first = await createEventWithApprovedBooking({
      name: "Record Check First",
      startsAt: "2026-12-30 10:00:00",
      endsAt: "2026-12-30 14:00:00",
      itemRequestedQuantity: 3,
    });
    const second = await createEventWithApprovedBooking({
      name: "Record Check Second",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-30 10:00:00",
      endsAt: "2026-12-30 14:00:00",
      itemRequestedQuantity: 2,
    });

    await handleReserveEquipment(
      { equipmentRequestId: first.equipmentRequestId, quantity: 3 },
      session("tech1"),
      database as never
    );

    const checked = await handleCheckEquipmentAvailability(
      { eventId: second.eventId, equipmentTypeId: testEquipmentTypeId },
      session("tech1"),
      database as never
    );
    expect(checked.available).toBe(1);
    expect(checked.reserved).toBe(3);
  });

  it("carries reservedQuantity on the coordinator projection for a reserved line (AC4)", async () => {
    const { eventId, equipmentRequestId } = await createEventWithApprovedBooking({
      name: "AC4 Coordinator Event",
      startsAt: "2026-12-31 10:00:00",
      endsAt: "2026-12-31 14:00:00",
      itemRequestedQuantity: 2,
    });

    await handleReserveEquipment(
      { equipmentRequestId, quantity: 2 },
      session("tech1"),
      database as never
    );

    const [projection] = await handleListEvents(
      { eventId },
      session("coordinator"),
      database as never
    );

    expect(projection.access).toBe("coordinator");
    const item = projection.event.equipment?.find(e => e.id === equipmentRequestId);
    expect(item).toBeDefined();
    expect(item?.arrangementStatus).toBe("reserved");
    expect(item?.reservedQuantity).toBe(2);
  });
});
