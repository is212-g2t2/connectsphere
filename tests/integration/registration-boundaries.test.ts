import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { env } from "#/env";
import { runSeed } from "../../scripts/seed";
import { sweepRegistrationWindows } from "#/features/events/registration-boundaries.server";

type Database = ReturnType<typeof drizzle<typeof schema>>;

describe("registration boundaries sweep (PTR-49)", () => {
  let pool: Pool;
  let database: Database;
  const created: number[] = [];

  const organiserId = "test-user-2"; // From seed
  const coordinatorId = "seed-coordinator-1"; // From seed

  beforeAll(async () => {
    pool = new Pool({ connectionString: env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await runSeed(database);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (created.length > 0) {
      await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
      created.length = 0;
    }
    await database.delete(schema.notifications);
  });

  async function createEvent(props: {
    opensAt: string | null;
    closesAt: string | null;
    confirmedAt?: Date;
    status?: "confirmed" | "cancelled" | "under_review";
    registrationEnabled?: boolean;
    assignedCoordinatorId?: string | null;
  }) {
    const status = props.status || "confirmed";
    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId,
        assignedCoordinatorId:
          props.assignedCoordinatorId !== undefined ? props.assignedCoordinatorId : coordinatorId,
        status,
        registrationEnabled:
          props.registrationEnabled !== undefined ? props.registrationEnabled : true,
        registrationCapacity: props.registrationEnabled === false ? null : 100,
        registrationOpensAt: props.registrationEnabled === false ? null : props.opensAt,
        registrationClosesAt: props.registrationEnabled === false ? null : props.closesAt,
        submittedAt: new Date("2020-01-01T00:00:00Z"),
        assignedAt: new Date("2020-01-01T00:00:00Z"),
        confirmedAt:
          status === "confirmed" ? (props.confirmedAt ?? new Date("2020-01-01T00:00:00Z")) : null,
        confirmedById: status === "confirmed" ? coordinatorId : null,
        confirmedByName: status === "confirmed" ? "Coordinator" : null,
        cancelledAt: status === "cancelled" ? new Date("2020-01-01T00:00:00Z") : null,
        cancelledById: status === "cancelled" ? coordinatorId : null,
        cancelledByName: status === "cancelled" ? "Coordinator" : null,
        decidedByCoordinatorId: status !== "under_review" ? coordinatorId : null,
        decidedByCoordinatorName: status !== "under_review" ? "Coordinator" : null,
        decidedAt: status !== "under_review" ? new Date("2020-01-01T00:00:00Z") : null,
        eventName: "Sweep Test Event",
        purpose: "test",
      } as never)
      .returning({ id: schema.eventRequests.id });
    created.push(row.id);
    return row.id;
  }

  test("TC01: ignores an event where now is before opensAt", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
    });

    const now = new Date("2030-01-01T09:00:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);

    expect(count).toBe(0);
    const notifs = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));
    expect(notifs).toHaveLength(0);
  });

  test("TC02: raises registration_opened when now is inside the window", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
    });

    const now = new Date("2030-01-01T10:05:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);

    expect(count).toBe(2);
    const notifs = await database
      .select({ kind: schema.notifications.kind, payload: schema.notifications.payload })
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));

    expect(notifs).toHaveLength(2);
    expect(notifs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "registration_opened",
          payload: expect.objectContaining({ audience: "coordinator" }),
        }),
        expect.objectContaining({
          kind: "registration_opened",
          payload: expect.objectContaining({ audience: "organiser" }),
        }),
      ])
    );
  });

  test("TC03: does not raise registration_opened twice", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
    });

    const now = new Date("2030-01-01T10:05:00+08:00");
    await sweepRegistrationWindows(database as never, now);
    const count2 = await sweepRegistrationWindows(database as never, now);

    expect(count2).toBe(0);
    const notifs = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));
    expect(notifs).toHaveLength(2);
  });

  test("TC04: raises both registration_opened and registration_closed when now is after closesAt", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
    });

    const now = new Date("2030-01-01T12:05:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);

    expect(count).toBe(4);
    const notifs = await database
      .select({ kind: schema.notifications.kind, payload: schema.notifications.payload })
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));

    expect(notifs).toHaveLength(4);

    expect(notifs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "registration_opened",
          payload: expect.objectContaining({ audience: "coordinator" }),
        }),
        expect.objectContaining({
          kind: "registration_opened",
          payload: expect.objectContaining({ audience: "organiser" }),
        }),
        expect.objectContaining({
          kind: "registration_closed",
          payload: expect.objectContaining({ audience: "coordinator" }),
        }),
        expect.objectContaining({
          kind: "registration_closed",
          payload: expect.objectContaining({ audience: "organiser" }),
        }),
      ])
    );
  });

  test("TC05: does not raise anything if confirmed after closesAt", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2030-01-01T13:00:00+08:00"),
    });

    const now = new Date("2030-01-01T14:00:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);

    expect(count).toBe(0);
    const notifs = await database
      .select({ kind: schema.notifications.kind, payload: schema.notifications.payload })
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));

    expect(notifs).toHaveLength(0);
  });

  test("TC05b: does not raise if confirmed within the close minute (12:00:30)", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2030-01-01T12:00:30+08:00"),
    });

    const now = new Date("2030-01-01T14:00:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);

    expect(count).toBe(0);
    const notifs = await database
      .select({ kind: schema.notifications.kind, payload: schema.notifications.payload })
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));

    expect(notifs).toHaveLength(0);
  });

  test("TC06: does not raise anything if registration is not enabled", async () => {
    await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      registrationEnabled: false,
    });

    const now = new Date("2030-01-01T10:05:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);
    expect(count).toBe(0);
  });

  test("TC07: does not raise anything if event is not confirmed", async () => {
    await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      status: "under_review",
    });

    const now = new Date("2030-01-01T10:05:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);
    expect(count).toBe(0);
  });

  test("TC07b (AC4): does not raise anything if the event was cancelled before the boundary", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      status: "cancelled",
    });

    const now = new Date("2030-01-01T10:05:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);

    expect(count).toBe(0);
    const notifs = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));
    expect(notifs).toHaveLength(0);
  });

  test("TC08: raises only for organiser if coordinator is not assigned", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      assignedCoordinatorId: null,
    });

    const now = new Date("2030-01-01T10:05:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);

    expect(count).toBe(1);
    const notifs = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));
    expect(notifs[0].recipientId).toBe(organiserId);
  });

  test("TC09: does not raise registration_closed twice", async () => {
    await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
    });

    const now = new Date("2030-01-01T12:05:00+08:00");
    await sweepRegistrationWindows(database as never, now);
    const count2 = await sweepRegistrationWindows(database as never, now);

    expect(count2).toBe(0);
  });

  test("TC10: does not raise duplicate notification if coordinator is also organiser", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
      assignedCoordinatorId: organiserId,
    });

    const now = new Date("2030-01-01T10:05:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);

    expect(count).toBe(1);
    const notifs = await database
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventRequestId, eventId));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].recipientId).toBe(organiserId);
  });

  test("TC11: ignores events outside 7d limit boundary", async () => {
    await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
    });

    // 8 days later: registration windows are well before limitMinute
    const now = new Date("2030-01-09T12:05:00+08:00");
    const count = await sweepRegistrationWindows(database as never, now);
    expect(count).toBe(0);
  });

  test("TC12: concurrent sweeps do not raise duplicate notifications", async () => {
    const eventId = await createEvent({
      opensAt: "2030-01-01T10:00",
      closesAt: "2030-01-01T12:00",
      confirmedAt: new Date("2020-01-01T00:00:00Z"),
    });

    const now = new Date("2030-01-01T10:05:00+08:00");

    // Create a second isolated connection pool to simulate a concurrent worker
    const pool2 = new Pool({ connectionString: env.DATABASE_URL });
    const database2 = drizzle(pool2, { schema });

    try {
      // Start both sweeps at exactly the same time. The first one will acquire
      // the pg_advisory_xact_lock(49, 0), and the second will block until the
      // first commits. When the second wakes up, the first has already inserted
      // the notifications, so the second will deduplicate and insert 0.
      const [count1, count2] = await Promise.all([
        sweepRegistrationWindows(database as never, now),
        sweepRegistrationWindows(database2 as never, now),
      ]);

      // Exactly one worker raises the 2 notifications, the other raises 0
      expect(count1 + count2).toBe(2);

      const notifs = await database
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.eventRequestId, eventId));
      expect(notifs).toHaveLength(2);
    } finally {
      await pool2.end();
    }
  });
});
