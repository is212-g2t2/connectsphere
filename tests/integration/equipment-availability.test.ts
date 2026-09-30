// Mirrors equipment-arrangement.test.ts: a local node-postgres drizzle instance.
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { runSeed } from "../../scripts/seed";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  handleCheckEquipmentAvailability,
  handleListEquipmentTypes,
} from "#/features/equipment-requests/availability.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const techSupport: SessionUser = {
  id: "seed-tech-support-1",
  role: "technical_support_staff",
  name: "seed-tech-support-1",
  email: "seed-tech-support-1@x.test",
};
const coordinatorId = "seed-coordinator-1";
const organiserId = "test-user-2";

describe("equipment availability (PTR-40)", () => {
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
    // Events cascade to bookings, lines and reservations; reservations restrict their type.
    if (eventIds.length > 0) {
      await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, eventIds));
    }
    if (typeIds.length > 0) {
      await database
        .delete(schema.equipmentTypes)
        .where(inArray(schema.equipmentTypes.id, typeIds));
    }
    if (venueIds.length > 0) {
      await database.delete(schema.venues).where(inArray(schema.venues.id, venueIds));
    }
    eventIds.length = venueIds.length = typeIds.length = 0;
  });

  async function createType(quantityHeld: number, name = `Projector ${crypto.randomUUID()}`) {
    const [row] = await database
      .insert(schema.equipmentTypes)
      .values({ name, quantityHeld })
      .returning();
    typeIds.push(row.id);
    return row;
  }

  /** A booking of `eventId` on its own venue (the overlap constraint is per venue). */
  async function addBooking(
    eventId: number,
    [start, end]: [string, string],
    {
      day = "2030-01-01",
      status = "approved",
    }: { day?: string; status?: "approved" | "pending" | "released" } = {}
  ) {
    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: `Availability venue ${crypto.randomUUID()}`,
        location: "Test",
        maxCapacity: 100,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    venueIds.push(venue.id);
    await database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId,
      venueId: venue.id,
      startsAt: `${day}T${start}:00`,
      endsAt: `${day}T${end}:00`,
      status,
      releaseReason: status === "released" ? "Test" : null,
      requestedById: coordinatorId,
    });
  }

  /**
   * An approved event with one submitted line and an approved booking on its own venue (the
   * booking overlap constraint is per venue, so each event gets one). The window is a pair of
   * times on 2030-01-01; `null` makes an event with no approved booking.
   */
  async function createEvent(window: [string, string] | null) {
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
        eventName: `Availability test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
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

    if (window) await addBooking(event.id, window);

    const [line] = await database
      .insert(schema.equipmentRequests)
      .values({ id: crypto.randomUUID(), eventId: event.id, item: "Projector", quantity: 1 })
      .returning();
    return { eventId: event.id, lineId: line.id };
  }

  async function reserve(lineId: string, equipmentTypeId: number, quantity: number) {
    await database
      .insert(schema.equipmentReservations)
      .values({ id: crypto.randomUUID(), equipmentRequestId: lineId, equipmentTypeId, quantity });
  }

  const check = (
    eventId: number,
    equipmentTypeId: number,
    requestedQuantity?: number,
    actor: SessionUser = techSupport
  ) =>
    handleCheckEquipmentAvailability(
      { eventId, equipmentTypeId, requestedQuantity },
      actor,
      database as never
    );

  test("AC1: held minus overlapping reservations", async () => {
    const type = await createType(10);
    const target = await createEvent(["10:00", "12:00"]);
    const other = await createEvent(["11:00", "13:00"]);
    await reserve(other.lineId, type.id, 3);

    const result = await check(target.eventId, type.id);

    expect(result).toMatchObject({ held: 10, reserved: 3, unavailable: 0, available: 7 });
    expect(result.equipmentTypeName).toBe(type.name);
    expect(result.period).toEqual({ startsAt: "2030-01-01T10:00", endsAt: "2030-01-01T12:00" });
  });

  test("AC2: unavailable units are excluded", async () => {
    const type = await createType(10);
    await database.insert(schema.equipmentUnavailability).values([
      { equipmentTypeId: type.id, quantityUnavailable: 2, reason: "Damaged" },
      { equipmentTypeId: type.id, quantityUnavailable: 1, reason: "Maintenance" },
    ]);
    const target = await createEvent(["10:00", "12:00"]);

    expect(await check(target.eventId, type.id)).toMatchObject({ unavailable: 3, available: 7 });
  });

  test("AC3: states the shortfall when the request exceeds what is free", async () => {
    const type = await createType(5);
    const target = await createEvent(["10:00", "12:00"]);

    expect(await check(target.eventId, type.id, 8)).toMatchObject({ available: 5, shortfall: 3 });
    expect(await check(target.eventId, type.id, 5)).toMatchObject({ shortfall: 0 });
  });

  test("AC4: non-overlapping and touching bookings do not reduce availability", async () => {
    const type = await createType(10);
    const target = await createEvent(["10:00", "12:00"]);
    const before = await createEvent(["08:00", "10:00"]);
    const after = await createEvent(["12:00", "14:00"]);
    const apart = await createEvent(["15:00", "16:00"]);
    await Promise.all([before, after, apart].map(other => reserve(other.lineId, type.id, 4)));

    expect((await check(target.eventId, type.id)).available).toBe(10);
  });

  test("ignores reservations of other types and the own event", async () => {
    const type = await createType(10);
    const otherType = await createType(10);
    const target = await createEvent(["10:00", "12:00"]);
    const other = await createEvent(["10:00", "12:00"]);
    await reserve(other.lineId, otherType.id, 4);
    await reserve(target.lineId, type.id, 6);

    expect((await check(target.eventId, type.id)).available).toBe(10);
  });

  test("counts a reservation once however many approved bookings its event has", async () => {
    const type = await createType(10);
    const target = await createEvent(["10:00", "12:00"]);
    const other = await createEvent(["10:00", "12:00"]);
    await addBooking(other.eventId, ["11:00", "13:00"]);
    await reserve(other.lineId, type.id, 4);

    expect((await check(target.eventId, type.id)).reserved).toBe(4);
  });

  test("a reservation whose event booking is not approved does not reduce availability", async () => {
    const type = await createType(10);
    const target = await createEvent(["10:00", "12:00"]);
    const pending = await createEvent(null);
    const released = await createEvent(null);
    await addBooking(pending.eventId, ["10:00", "12:00"], { status: "pending" });
    await addBooking(released.eventId, ["10:00", "12:00"], { status: "released" });
    await reserve(pending.lineId, type.id, 4);
    await reserve(released.lineId, type.id, 3);

    expect((await check(target.eventId, type.id)).available).toBe(10);
  });

  test("with several approved bookings, reports the tightest one and its period", async () => {
    const type = await createType(10);
    const target = await createEvent(["10:00", "12:00"]);
    await addBooking(target.eventId, ["10:00", "12:00"], { day: "2030-01-02" });
    const other = await createEvent(null);
    await addBooking(other.eventId, ["11:00", "13:00"], { day: "2030-01-02" });
    await reserve(other.lineId, type.id, 4);

    const result = await check(target.eventId, type.id);

    expect(result).toMatchObject({ reserved: 4, available: 6 });
    expect(result.period).toEqual({ startsAt: "2030-01-02T10:00", endsAt: "2030-01-02T12:00" });
  });

  test("refuses an event with no approved venue booking", async () => {
    const type = await createType(10);
    const target = await createEvent(null);

    await expect(check(target.eventId, type.id)).rejects.toBeInstanceOf(ConflictError);
  });

  test("refuses a missing type", async () => {
    const target = await createEvent(["10:00", "12:00"]);

    await expect(check(target.eventId, 2_000_000_000)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("scopes access with the queue rule: a colleague's line is refused", async () => {
    const type = await createType(10);
    const target = await createEvent(["10:00", "12:00"]);
    await database
      .update(schema.equipmentRequests)
      .set({ assignedStaffId: techSupport.id, arrangementStatus: "not_required" })
      .where(eq(schema.equipmentRequests.id, target.lineId));

    await expect(
      check(target.eventId, type.id, undefined, { ...techSupport, id: "someone-else" })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("lists types ordered by name", async () => {
    const b = await createType(1, `zz-b-${crypto.randomUUID()}`);
    const a = await createType(1, `zz-a-${crypto.randomUUID()}`);

    const ids = (await handleListEquipmentTypes(database as never)).map(t => t.id);

    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
  });
});
