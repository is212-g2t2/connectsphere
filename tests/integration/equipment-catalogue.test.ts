// PTR-162 catalogue maintenance: held and out-of-service writes, delete refusals, line
// mapping, and venue-wide availability. Uses a local node-postgres Drizzle instance.
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import {
  handleCheckEquipmentAvailability,
  handleDeleteEquipmentType,
  handleSaveEquipmentType,
  handleSaveEquipmentUnavailability,
} from "#/features/equipment-requests/availability.server";
import { handleMapEquipmentLine } from "#/features/equipment-requests/equipment.server";
import {
  handleCheckLineAvailability,
  handleReserveEquipment,
} from "#/features/equipment-requests/reservations.server";
import {
  EQUIPMENT_CATALOGUE_DELETE_REFUSAL,
  EQUIPMENT_LINE_UNMAPPED_MESSAGE,
  EQUIPMENT_UNAVAILABILITY_EXCEEDS_HELD_MESSAGE,
  equipmentHeldBelowUnavailableMessage,
  equipmentUnavailabilityMissingMessage,
} from "#/features/equipment-requests/schema";
import { handleListEvents } from "#/features/events/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import { runSeed } from "../../scripts/seed";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const techSupport: SessionUser = {
  id: "seed-tech-support-1",
  role: "technical_support_staff",
  name: "seed-tech-support-1",
  email: "seed-tech-support-1@x.test",
};
const coordinatorId = "seed-coordinator-1";
const organiserId = "test-user-2";

describe("equipment catalogue (PTR-162)", () => {
  let pool: Pool;
  let database: Database;
  const eventIds: number[] = [];
  const venueIds: number[] = [];
  const typeIds: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await runSeed(database);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (eventIds.length > 0) {
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
    if (typeIds.length > 0) {
      await database
        .delete(schema.equipmentUnavailability)
        .where(inArray(schema.equipmentUnavailability.equipmentTypeId, typeIds));
      await database
        .delete(schema.equipmentTypes)
        .where(inArray(schema.equipmentTypes.id, typeIds));
    }
    if (venueIds.length > 0) {
      await database.delete(schema.venues).where(inArray(schema.venues.id, venueIds));
    }
    eventIds.length = venueIds.length = typeIds.length = 0;
  });

  async function createType(quantityHeld: number, name = `Catalogue type ${crypto.randomUUID()}`) {
    const [row] = await database
      .insert(schema.equipmentTypes)
      .values({ name, quantityHeld })
      .returning();
    typeIds.push(row.id);
    return row;
  }

  async function createEvent(params: {
    startsAt: string;
    endsAt: string;
    venueId?: number;
    item?: string;
    quantity?: number;
    equipmentTypeId?: number | null;
  }) {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId,
        status: "approved",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinatorId,
        assignedAt: new Date(),
        decidedByCoordinatorId: coordinatorId,
        decidedByCoordinatorName: "Coordinator",
        decidedAt: new Date(),
        equipmentSubmittedAt: new Date(),
        eventName: `Catalogue test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [
          { start: params.startsAt.replace(" ", "T"), end: params.endsAt.replace(" ", "T") },
        ],
        registrationOpensAt: "2029-12-01T09:00",
        registrationClosesAt: "2029-12-31T17:00",
        expectedAttendance: 10,
        venueRequirements: "",
        roomLayoutPreference: "",
        accessibilityRequirements: "",
        description: "",
        eventType: "Conference",
        equipmentRequirements: [],
        specialArrangements: "",
        registrationEnabled: true,
        registrationCapacity: 10,
      })
      .returning({ id: schema.eventRequests.id });
    eventIds.push(event.id);

    let venueId = params.venueId;
    if (venueId === undefined) {
      const [venue] = await database
        .insert(schema.venues)
        .values({
          name: `Catalogue venue ${crypto.randomUUID()}`,
          location: "Test",
          maxCapacity: 100,
          operatingHours: DEFAULT_OPERATING_HOURS,
        })
        .returning({ id: schema.venues.id });
      venueIds.push(venue.id);
      venueId = venue.id;
    }
    await database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      venueId,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      status: "approved",
      requestedById: coordinatorId,
    });

    const [line] = await database
      .insert(schema.equipmentRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: event.id,
        item: params.item ?? "Catalogue item",
        quantity: params.quantity ?? 1,
        ...(params.equipmentTypeId === undefined
          ? {}
          : { equipmentTypeId: params.equipmentTypeId }),
      })
      .returning();
    return { eventId: event.id, lineId: line.id };
  }

  test("AC1: availability checks and reservations use the saved held quantity", async () => {
    const type = await createType(10);
    const target = await createEvent({
      startsAt: "2030-02-01 10:00:00",
      endsAt: "2030-02-01 12:00:00",
    });

    const before = await handleCheckEquipmentAvailability(
      { eventId: target.eventId, equipmentTypeId: type.id },
      techSupport,
      database as never
    );
    expect(before).toMatchObject({ held: 10, available: 10 });

    await handleSaveEquipmentType(
      { id: type.id, name: type.name, quantityHeld: 4 },
      techSupport,
      database as never
    );
    const after = await handleCheckEquipmentAvailability(
      { eventId: target.eventId, equipmentTypeId: type.id },
      techSupport,
      database as never
    );
    expect(after).toMatchObject({ held: 4, available: 4 });
  });

  test("AC2: refuses an out-of-service total that exceeds the quantity held", async () => {
    const type = await createType(5);
    await handleSaveEquipmentUnavailability(
      { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 3 },
      techSupport,
      database as never
    );
    await expect(
      handleSaveEquipmentUnavailability(
        { equipmentTypeId: type.id, reason: "Repair", quantityUnavailable: 3 },
        techSupport,
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: EQUIPMENT_UNAVAILABILITY_EXCEEDS_HELD_MESSAGE,
    });
    // Raising the first reason past the held total refuses too.
    await expect(
      handleSaveEquipmentUnavailability(
        { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 6 },
        techSupport,
        database as never
      )
    ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
  });

  test("AC2: saving the same reason twice does not count the units twice", async () => {
    const type = await createType(5);
    await handleSaveEquipmentUnavailability(
      { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 3 },
      techSupport,
      database as never
    );
    await expect(
      handleSaveEquipmentUnavailability(
        { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 3 },
        techSupport,
        database as never
      )
    ).resolves.toMatchObject({ quantityUnavailable: 3 });
    expect(
      await database
        .select()
        .from(schema.equipmentUnavailability)
        .where(eq(schema.equipmentUnavailability.equipmentTypeId, type.id))
    ).toHaveLength(1);
  });

  test("AC2: entering zero clears the reason so held can drop below the recorded total", async () => {
    const type = await createType(5);
    await handleSaveEquipmentUnavailability(
      { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 3 },
      techSupport,
      database as never
    );
    await expect(
      handleSaveEquipmentUnavailability(
        { equipmentTypeId: type.id, reason: "Repair", quantityUnavailable: 0 },
        techSupport,
        database as never
      )
    ).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
      message: equipmentUnavailabilityMissingMessage("Repair"),
    });
    await handleSaveEquipmentUnavailability(
      { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 0 },
      techSupport,
      database as never
    );
    expect(
      await database
        .select()
        .from(schema.equipmentUnavailability)
        .where(eq(schema.equipmentUnavailability.equipmentTypeId, type.id))
    ).toEqual([]);
    await expect(
      handleSaveEquipmentType(
        { id: type.id, name: type.name, quantityHeld: 2 },
        techSupport,
        database as never
      )
    ).resolves.toMatchObject({ quantityHeld: 2 });
  });

  test("AC2: a concurrent out-of-service write cannot slip past the held check", async () => {
    const type = await createType(5);
    await handleSaveEquipmentUnavailability(
      { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 3 },
      techSupport,
      database as never
    );
    // Hold the type-row lock on a second connection, as a concurrent unavailability save
    // would. The held save below waits on that lock, then reads the committed total.
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM equipment_types WHERE id = $1 FOR UPDATE", [type.id]);
      const [{ pid }] = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows;
      let settled = false;
      const save = handleSaveEquipmentType(
        { id: type.id, name: type.name, quantityHeld: 3 },
        techSupport,
        database as never
      ).then(
        value => {
          settled = true;
          return value;
        },
        error => {
          settled = true;
          throw error;
        }
      );
      // Wait until the save blocks on the holder's type-row lock. Racing the save
      // against that wait proves the save is still waiting when the holder commits,
      // instead of trusting a sleep to order the two.
      async function waitForBlocker(deadline: number): Promise<"waiting"> {
        const result = await pool.query<{ waiting: number }>(
          "select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and $1::int = any(pg_blocking_pids(pid))",
          [pid]
        );
        if (result.rows[0].waiting > 0) return "waiting";
        if (Date.now() > deadline) {
          throw new Error("The held save never blocked on the type-row lock.");
        }
        await new Promise(resolve => setTimeout(resolve, 25));
        return waitForBlocker(deadline);
      }
      const state = await Promise.race([
        save.then(
          () => "settled" as const,
          () => "settled" as const
        ),
        waitForBlocker(Date.now() + 5000),
      ]);
      expect(state).toBe("waiting");
      expect(settled).toBe(false);
      await holder.query(
        "UPDATE equipment_unavailability SET quantity_unavailable = 5 WHERE equipment_type_id = $1 AND reason = 'Maintenance'",
        [type.id]
      );
      await holder.query("COMMIT");
      await expect(save).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: equipmentHeldBelowUnavailableMessage(3, 5),
      });
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
    const [held] = await database
      .select()
      .from(schema.equipmentTypes)
      .where(eq(schema.equipmentTypes.id, type.id));
    expect(held.quantityHeld).toBe(5);
  });

  test("AC2: refuses a held quantity below the recorded out-of-service total", async () => {
    const type = await createType(5);
    await handleSaveEquipmentUnavailability(
      { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 3 },
      techSupport,
      database as never
    );
    await expect(
      handleSaveEquipmentType(
        { id: type.id, name: type.name, quantityHeld: 2 },
        techSupport,
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: equipmentHeldBelowUnavailableMessage(2, 3),
    });
  });

  test("AC4: refuses to delete a type that a line references", async () => {
    const type = await createType(4);
    await createEvent({
      startsAt: "2030-02-02 10:00:00",
      endsAt: "2030-02-02 12:00:00",
      equipmentTypeId: type.id,
    });
    await expect(
      handleDeleteEquipmentType({ id: type.id }, techSupport, database as never)
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: EQUIPMENT_CATALOGUE_DELETE_REFUSAL,
    });
  });

  test("AC4: refuses to delete a type that a reservation references", async () => {
    // The line still maps the same type, so the line refusal fires first. This case keeps
    // the reservation branch covered as defence-in-depth; `db-schema.test.ts` asserts the
    // `restrict` foreign keys behind both checks.
    const type = await createType(4);
    const target = await createEvent({
      startsAt: "2030-02-03 10:00:00",
      endsAt: "2030-02-03 12:00:00",
      equipmentTypeId: type.id,
      quantity: 2,
    });
    await handleReserveEquipment(
      { equipmentRequestId: target.lineId, quantity: 2 },
      techSupport,
      database as never
    );
    await expect(
      handleDeleteEquipmentType({ id: type.id }, techSupport, database as never)
    ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
  });

  test("AC4: deletes an unreferenced type with its out-of-service rows", async () => {
    const type = await createType(4);
    await handleSaveEquipmentUnavailability(
      { equipmentTypeId: type.id, reason: "Maintenance", quantityUnavailable: 1 },
      techSupport,
      database as never
    );
    await handleDeleteEquipmentType({ id: type.id }, techSupport, database as never);
    typeIds.splice(typeIds.indexOf(type.id), 1);
    expect(
      await database
        .select()
        .from(schema.equipmentTypes)
        .where(eq(schema.equipmentTypes.id, type.id))
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(schema.equipmentUnavailability)
        .where(eq(schema.equipmentUnavailability.equipmentTypeId, type.id))
    ).toEqual([]);
  });

  test("AC5: an unmapped line stays on the work list and reserves after mapping", async () => {
    const type = await createType(4);
    const target = await createEvent({
      startsAt: "2030-02-04 10:00:00",
      endsAt: "2030-02-04 12:00:00",
      item: "Free-text projector",
      equipmentTypeId: null,
    });

    const [projection] = await handleListEvents(
      { eventId: target.eventId },
      techSupport,
      database as never
    );
    const line = (
      projection.event as { equipment: Array<{ id: string; equipmentTypeId: number | null }> }
    ).equipment.find(row => row.id === target.lineId);
    expect(line?.equipmentTypeId).toBeNull();

    await expect(
      handleCheckLineAvailability(
        { equipmentRequestId: target.lineId },
        techSupport,
        database as never
      )
    ).rejects.toMatchObject({
      name: "ConflictError",
      status: 409,
      message: EQUIPMENT_LINE_UNMAPPED_MESSAGE,
    });

    await handleMapEquipmentLine(
      { eventId: target.eventId, id: target.lineId, equipmentTypeId: type.id },
      techSupport,
      database as never
    );
    await expect(
      handleReserveEquipment(
        { equipmentRequestId: target.lineId, quantity: 1 },
        techSupport,
        database as never
      )
    ).resolves.toMatchObject({ quantity: 1 });
  });

  test("AC6: one type serves events at every venue", async () => {
    const type = await createType(4);
    const first = await createEvent({
      startsAt: "2030-02-05 10:00:00",
      endsAt: "2030-02-05 12:00:00",
      equipmentTypeId: type.id,
      quantity: 2,
    });
    const second = await createEvent({
      startsAt: "2030-02-05 10:00:00",
      endsAt: "2030-02-05 12:00:00",
      equipmentTypeId: type.id,
      quantity: 2,
    });
    await expect(
      handleReserveEquipment(
        { equipmentRequestId: first.lineId, quantity: 2 },
        techSupport,
        database as never
      )
    ).resolves.toMatchObject({ quantity: 2 });
    // The second event books another venue at the same time. The shared type still covers it.
    await expect(
      handleReserveEquipment(
        { equipmentRequestId: second.lineId, quantity: 2 },
        techSupport,
        database as never
      )
    ).resolves.toMatchObject({ quantity: 2 });
  });
});
