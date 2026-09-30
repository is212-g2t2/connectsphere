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
  handleSaveEquipmentLine,
  handleUpdateArrangement,
} from "#/features/equipment-requests/equipment.server";
import {
  ARRANGEMENT_RESERVED_MESSAGE,
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

    // Clean up any stale test fixtures
    await cleanup();

    // Insert fixture users in parallel
    await Promise.all(
      Object.values(fixtureUsers).map(u =>
        database.insert(schema.user).values(u).onConflictDoNothing()
      )
    );

    // Insert fixture venues (need two venues so concurrent events can book same time without venue collision)
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

    // Insert dedicated test equipment type (5 held, 1 unavailable -> 4 serviceable)
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

    // Verify DB state
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

    // Reserving remaining quantity upgrades line to reserved
    const secondResult = await handleReserveEquipment(
      { equipmentRequestId, quantity: 3 },
      session("tech1"),
      database as never
    );

    expect(secondResult.quantity).toBe(3);
    expect(secondResult.arrangementStatus).toBe("reserved");
  });

  it("refuses reservation exceeding available inventory with 409 Conflict and states exact shortfall (AC2, PTR-40 AC3)", async () => {
    // 5 held, 1 unavailable -> 4 available
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
    // Event 1: 10:00 to 14:00
    const event1 = await createEventWithApprovedBooking({
      name: "Overlapping Event 1",
      startsAt: "2026-12-04 10:00:00",
      endsAt: "2026-12-04 14:00:00",
      itemRequestedQuantity: 3,
    });

    // Event 2: 12:00 to 16:00 (overlaps Event 1 from 12:00 to 14:00)
    const event2 = await createEventWithApprovedBooking({
      name: "Overlapping Event 2",
      venueId: fixtureVenueId2,
      startsAt: "2026-12-04 12:00:00",
      endsAt: "2026-12-04 16:00:00",
      itemRequestedQuantity: 2,
    });

    // Event 1 reserves 3 of 4 units
    await handleReserveEquipment(
      { equipmentRequestId: event1.equipmentRequestId, quantity: 3 },
      session("tech1"),
      database as never
    );

    // Event 2 attempts to reserve 2 units during overlapping window (only 1 remaining)
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

    // Event 2 reserves 1 unit (the remaining quantity) -> succeeds!
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
    // Total serviceable is 4.
    // Event A and Event B both overlap 10:00 to 14:00 and concurrently ask for 3 units each.
    // Combined would be 6 > 4.
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

    // Exactly one must succeed and one must be refused
    expect(successes).toHaveLength(1);
    expect(rejections).toHaveLength(1);

    // Verify DB invariant: sum of reserved units is exactly 3 (<= 4)
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

    // Venue request is pending, not approved
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
      message: "Event must have an approved venue booking before equipment can be reserved",
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

    // Tech 2 has no line on the event at all, so the queue gate refuses before the line does.
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

    // An unassigned second line keeps the event workable for Tech 2, so the refusal names the
    // line rather than the event.
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

  it("refuses reservation when the event has more than one approved venue booking", async () => {
    const { eventId, equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Two Bookings Event",
      startsAt: "2026-12-09 10:00:00",
      endsAt: "2026-12-09 12:00:00",
    });

    // A second approved booking makes the reservation period ambiguous, so it is refused rather
    // than bound to an arbitrary one.
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
      message:
        "Event has more than one approved venue booking; equipment can only be reserved against a single period",
    });
  });

  it("resolves the catalogue type by name when the line has none yet", async () => {
    const { equipmentRequestId } = await createEventWithApprovedBooking({
      name: "Name Match Event",
      startsAt: "2026-12-10 10:00:00",
      endsAt: "2026-12-10 12:00:00",
      itemRequestedQuantity: 1,
      equipmentTypeId: null,
      item: testEquipmentTypeName,
    });

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

  it("refuses a line whose item is not in the catalogue and has no type link", async () => {
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
      message:
        'Cannot reserve equipment: catalogue item "Unregistered Fog Machine" is not registered in equipment catalogue',
    });
  });

  it("treats back-to-back bookings as non-overlapping", async () => {
    // Serviceable capacity is 4; touching periods are free, so both events can take it all.
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
    // The competing event's reservation snapshots its booking (10–12); a second approved booking
    // is added afterwards (approvals can accumulate after the fact). The stored period still
    // counts once (3 of 4), so the target keeps its 1 free unit.
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
    // Two reservations that do not overlap each other (10–12 and 12–14) each take 3 of the 4
    // serviceable units. A third event spanning 11–13 sees a peak of 3, so 1 unit is still free;
    // summing the two would wrongly report none.
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
      // Assigned to the actor so the queue gate passes and the state gate answers.
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

    // The snapshot still commits the morning window, so a rival there finds nothing free.
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

    // Re-reserving re-scopes the snapshot to the amended booking and frees the morning.
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
    // 5 held, 1 unavailable -> 4 serviceable, nothing reserved yet.
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

    // 2 of 4 committed to this line, but its own row does not count against itself.
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
    // A partial reservation keeps the line `requested`: the row below commits 1 of 3 units
    // without moving the state, so only the reservation-row guard can see it.
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
    // 5 held, 1 unavailable -> 4 serviceable. The first event commits 3 through the reserve
    // handler; the overlapping second event reads the reduction through the check handler.
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
