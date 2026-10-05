// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { runSeed } from "../../scripts/seed";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { handleReserveEquipment } from "#/features/equipment-requests/reservations.server";
import { EVENT_HAS_NOT_ENDED_MESSAGE } from "#/features/events/completion";
import { handleCompleteEvent } from "#/features/events/complete.server";
import { handleApproveVenueRequest } from "#/features/venue-requests/requests.server";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const actor = (id: string, role: string, name: string): SessionUser => ({
  id,
  role,
  name,
  email: `${id}@x.test`,
});

const coordinator = actor("seed-coordinator-1", "event_coordinator", "Seeded Event Coordinator");
const stranger = actor("completion-other-coordinator", "event_coordinator", "Other Coordinator");
const organiser = actor("test-user-2", "event_organiser", "Jane Doe");
const venueStaff = actor("seed-venue-staff-1", "venue_staff", "Seeded Venue Staff");
const tech = actor("seed-tech-support-1", "technical_support_staff", "Seeded Technical Support");

describe("completing an event (PTR-25)", () => {
  let pool: Pool;
  let database: Database;
  let venueIds: number[];
  let equipmentTypeId: number;
  const created: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await runSeed(database);
    await database
      .insert(schema.user)
      .values({
        id: stranger.id,
        name: "Other Coordinator",
        email: "completion-other-coordinator@x.test",
        emailVerified: true,
        role: "event_coordinator",
      })
      .onConflictDoNothing();
    venueIds = (await database.select({ id: schema.venues.id }).from(schema.venues).limit(2)).map(
      row => row.id
    );
    equipmentTypeId = (
      await database.select({ id: schema.equipmentTypes.id }).from(schema.equipmentTypes).limit(1)
    )[0].id;
  });

  afterEach(async () => {
    if (created.length === 0) return;
    await database
      .delete(schema.equipmentRequests)
      .where(inArray(schema.equipmentRequests.eventId, created));
    await database
      .delete(schema.venueRequests)
      .where(inArray(schema.venueRequests.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });

  afterAll(async () => {
    await database.delete(schema.user).where(eq(schema.user.id, stranger.id));
    await pool.end();
  });

  async function createConfirmedEvent(endsAt = "2020-03-10 12:30:00") {
    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status: "confirmed",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
        decidedByCoordinatorId: coordinator.id,
        decidedByCoordinatorName: coordinator.name,
        decidedAt: new Date(),
        confirmedById: coordinator.id,
        confirmedByName: coordinator.name,
        confirmedAt: new Date(),
        equipmentSubmittedAt: new Date(),
        eventName: `PTR-25 integration ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [
          { start: endsAt.slice(0, 10) + "T09:00", end: endsAt.slice(0, 16).replace(" ", "T") },
        ],
        expectedAttendance: 10,
        eventType: "Conference",
      })
      .returning();
    created.push(event.id);
    await database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      venueId: venueIds[0],
      requestedById: coordinator.id,
      startsAt: `${endsAt.slice(0, 10)} 09:00:00`,
      endsAt,
      status: "approved",
      assignedStaffId: venueStaff.id,
    });
    return event;
  }

  const complete = (eventId: number, as: SessionUser = coordinator) =>
    handleCompleteEvent({ id: eventId }, as, database as never);

  test("marks an ended confirmed event completed and records actor and time", async () => {
    const event = await createConfirmedEvent();
    const before = Date.now();

    await complete(event.id);

    const [saved] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, event.id));
    expect(saved.status).toBe("completed");
    expect(saved.completedById).toBe(coordinator.id);
    expect(saved.completedByName).toBe(coordinator.name);
    expect(saved.completedAt).toBeInstanceOf(Date);
    expect(saved.completedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("compares the event end with the Singapore wall-clock time", async () => {
    const event = await createConfirmedEvent("2100-03-10 12:30:00");
    await database
      .update(schema.venueRequests)
      .set({
        startsAt: sql`timezone('Asia/Singapore', now()) - interval '2 hours'`,
        endsAt: sql`timezone('Asia/Singapore', now()) - interval '1 minute'`,
      })
      .where(eq(schema.venueRequests.eventId, event.id));

    await expect(complete(event.id)).resolves.toMatchObject({ status: "completed" });
  });

  test("uses the latest end when a confirmed event has multiple approved bookings", async () => {
    const event = await createConfirmedEvent();
    await database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      venueId: venueIds[1],
      requestedById: coordinator.id,
      startsAt: "2100-03-10 09:00:00",
      endsAt: "2100-03-10 12:30:00",
      status: "approved",
      assignedStaffId: venueStaff.id,
    });

    await expect(complete(event.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(EVENT_HAS_NOT_ENDED_MESSAGE),
    });
  });

  test("falls back to the event end after an approved booking is released", async () => {
    const event = await createConfirmedEvent();
    await database
      .update(schema.venueRequests)
      .set({ status: "released", releaseReason: "Operational change" })
      .where(eq(schema.venueRequests.eventId, event.id));

    await expect(complete(event.id)).resolves.toMatchObject({ status: "completed" });
  });

  test("refuses completion before the event end and preserves confirmation", async () => {
    const event = await createConfirmedEvent("2100-03-10 12:30:00");

    await expect(complete(event.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(EVENT_HAS_NOT_ENDED_MESSAGE),
    });

    const [saved] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, event.id));
    expect(saved.status).toBe("confirmed");
    expect(saved.completedAt).toBeNull();
  });

  test("refuses an event that is not confirmed", async () => {
    const event = await createConfirmedEvent();
    await database
      .update(schema.eventRequests)
      .set({ status: "approved", confirmedById: null, confirmedByName: null, confirmedAt: null })
      .where(eq(schema.eventRequests.id, event.id));

    await expect(complete(event.id)).rejects.toBeInstanceOf(ConflictError);
  });

  test("refuses a different Coordinator without revealing the event", async () => {
    const event = await createConfirmedEvent();

    await expect(complete(event.id, stranger)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(complete(2_000_000_000, stranger)).rejects.toBeInstanceOf(AuthorizationError);
  });

  test("refuses a new venue booking after completion", async () => {
    const event = await createConfirmedEvent();
    await complete(event.id);
    const [pending] = await database
      .insert(schema.venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: event.id,
        venueId: venueIds[1],
        requestedById: coordinator.id,
        startsAt: "2100-03-10 09:00:00",
        endsAt: "2100-03-10 12:30:00",
        status: "pending",
      })
      .returning();

    await expect(
      handleApproveVenueRequest({ id: pending.id }, venueStaff, database as never)
    ).rejects.toMatchObject({ status: 409 });
  });

  test("refuses a new equipment reservation after completion", async () => {
    const event = await createConfirmedEvent();
    const [line] = await database
      .insert(schema.equipmentRequests)
      .values({
        id: crypto.randomUUID(),
        eventId: event.id,
        equipmentTypeId,
        assignedStaffId: tech.id,
        item: "Projector",
        quantity: 1,
        arrangementStatus: "requested",
      })
      .returning();
    await complete(event.id);

    await expect(
      handleReserveEquipment({ equipmentRequestId: line.id, quantity: 1 }, tech, database as never)
    ).rejects.toMatchObject({ status: 409 });
  });
});
