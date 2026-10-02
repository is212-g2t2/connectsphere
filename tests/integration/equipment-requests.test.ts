// Mirrors event-list.test.ts: a local node-postgres drizzle instance, not the app's `#/db`
// (which is configured with the bun-sql driver and does not accept this codebase's query shapes
// in a test context — see the "client.unsafe is not a function" failure this replaces).
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { runSeed } from "../../scripts/seed";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  handleSaveEquipmentLine,
  handleRemoveEquipmentLine,
  handleSubmitEquipmentRequest,
} from "#/features/equipment-requests/equipment.server";
import { handleDecideEventRequest } from "#/features/coordination/assignments.server";
import { handleListEvents } from "#/features/events/records.server";
import { EQUIPMENT_MAX_LINES } from "#/features/event-requests/schema";
import { EQUIPMENT_NO_LINES_MESSAGE } from "#/features/equipment-requests/schema";

const sendEmail = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async (..._args) => {})
);
vi.mock("#/lib/mailer.server", () => ({ sendEmail }));

type Database = ReturnType<typeof drizzle<typeof schema>>;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const actor = (id: string, role: string): SessionUser => ({
  id,
  role,
  name: id,
  email: `${id}@x.test`,
});

const coordinator = actor("seed-coordinator-1", "event_coordinator");
const stranger = actor("some-other-coordinator", "event_coordinator");
const techSupport = actor("seed-tech-support-1", "technical_support_staff");
const otherTechSupport = actor("other-tech-support", "technical_support_staff");

describe("equipment handlers (PTR-38 / PTR-39)", () => {
  let pool: Pool;
  let database: Database;
  const created: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await runSeed(database);

    // The stranger coordinator isn't part of runSeed's fixtures; insert it so
    // handleAssignEventRequest-style lookups (and this file's own checks) have a real row.
    await database
      .insert(schema.user)
      .values([
        {
          id: stranger.id,
          name: "Some Other Coordinator",
          email: "stranger.coordinator@example.com",
          emailVerified: true,
          role: "event_coordinator",
        },
        {
          id: otherTechSupport.id,
          name: "Other Tech Support",
          email: "other.tech.support@example.com",
          emailVerified: true,
          role: "technical_support_staff",
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await database
      .delete(schema.user)
      .where(inArray(schema.user.id, [stranger.id, otherTechSupport.id]));
    await pool.end();
  });

  afterEach(async () => {
    sendEmail.mockClear();
    if (created.length === 0) return;
    await database
      .delete(schema.equipmentRequests)
      .where(inArray(schema.equipmentRequests.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });

  // Statuses only reachable in real use after handleDecideEventRequest has run, so the DB's
  // `event_requests_decision_matches_status` CHECK expects the decision columns to be set
  // alongside them. "planning" and "confirmed" both follow an approval in this app's lifecycle.
  const DECIDED_STATUSES = new Set(["approved", "rejected", "planning", "confirmed"]);

  async function createEvent(
    status: string,
    extra: Partial<typeof schema.eventRequests.$inferInsert> = {}
  ) {
    const decisionDefaults = DECIDED_STATUSES.has(status)
      ? {
          decidedByCoordinatorId: coordinator.id,
          decidedByCoordinatorName: "Event List Coordinator",
          decidedAt: new Date(),
          decisionReason: status === "rejected" ? "Test rejection" : null,
        }
      : {};
    // PTR-24: a confirmed event always records who confirmed it and when.
    const confirmationDefaults =
      status === "confirmed"
        ? {
            confirmedById: coordinator.id,
            confirmedByName: "Event List Coordinator",
            confirmedAt: new Date(),
          }
        : {};

    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: "test-user-2",
        status: status as never,
        ...confirmationDefaults,
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
        eventName: `Equip test ${crypto.randomUUID()}`,
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
        ...decisionDefaults,
        ...extra,
      })
      .returning({ id: schema.eventRequests.id });
    created.push(row.id);
    return row.id;
  }

  const linesOf = (eventId: number) =>
    database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.eventId, eventId));

  // ── AC1, AC3, AC4 ──────────────────────────────────────────────────────────────────────────
  describe("handleSaveEquipmentLine", () => {
    test("AC1: adds lines with type, quantity and notes; further lines can be added", async () => {
      const id = await createEvent("approved");
      const a = await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1, notes: "HDMI" },
        coordinator,
        database as never
      );
      await handleSaveEquipmentLine(
        { eventId: id, item: "Microphone", quantity: 2 },
        coordinator,
        database as never
      );

      expect(a.assignedStaffId).toBeNull();
      const rows = await linesOf(id);
      expect(rows).toHaveLength(2);
      expect(rows.find(r => r.item === "Projector")).toMatchObject({
        quantity: 1,
        notes: "HDMI",
      });
      expect(rows.find(r => r.item === "Microphone")).toMatchObject({
        quantity: 2,
        notes: null,
      });
    });

    test("AC4: works on approved and planning", async () => {
      // oxlint-disable no-await-in-loop
      for (const status of ["approved", "planning"]) {
        const id = await createEvent(status);
        await handleSaveEquipmentLine(
          { eventId: id, item: "Cable", quantity: 3 },
          coordinator,
          database as never
        );
        expect(await linesOf(id)).toHaveLength(1);
      }
    });

    test.each(["submitted", "under_review", "rejected", "confirmed"])(
      "AC4: refuses status %s with ConflictError",
      async status => {
        const id = await createEvent(status);
        await expect(
          handleSaveEquipmentLine(
            { eventId: id, item: "X", quantity: 1 },
            coordinator,
            database as never
          )
        ).rejects.toBeInstanceOf(ConflictError);
        expect(await linesOf(id)).toHaveLength(0);
      }
    );

    test("a coordinator not assigned to the event gets AuthorizationError", async () => {
      const id = await createEvent("approved");
      await expect(
        handleSaveEquipmentLine(
          { eventId: id, item: "X", quantity: 1 },
          stranger,
          database as never
        )
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    test("edit updates in place", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1 },
        coordinator,
        database as never
      );
      await handleSaveEquipmentLine(
        {
          eventId: id,
          id: line.id,
          item: "Projector",
          quantity: 4,
          notes: "Ceiling mount",
        },
        coordinator,
        database as never
      );
      const rows = await linesOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ quantity: 4, notes: "Ceiling mount" });
    });

    test("editing another event's line is NotFound and leaves it untouched", async () => {
      const mine = await createEvent("approved");
      const theirs = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: theirs, item: "Theirs", quantity: 1 },
        coordinator,
        database as never
      );
      await expect(
        handleSaveEquipmentLine(
          { eventId: mine, id: line.id, item: "Hijack", quantity: 9 },
          coordinator,
          database as never
        )
      ).rejects.toBeInstanceOf(NotFoundError);
      expect((await linesOf(theirs))[0]).toMatchObject({
        item: "Theirs",
        quantity: 1,
      });
    });

    test.each([0, -1, 1.5])(
      "AC3: quantity %p is refused and nothing is written",
      async quantity => {
        const id = await createEvent("approved");
        await expect(
          handleSaveEquipmentLine(
            { eventId: id, item: "X", quantity },
            coordinator,
            database as never
          )
        ).rejects.toThrow(/quantity/i);
        expect(await linesOf(id)).toHaveLength(0);
      }
    );

    test("AC3 backstop: the DB CHECK rejects quantity 0 on a raw insert", async () => {
      const id = await createEvent("approved");
      let caught: unknown;
      try {
        await database.insert(schema.equipmentRequests).values({
          id: crypto.randomUUID(),
          eventId: id,
          item: "X",
          quantity: 0,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const cause = (caught as { cause?: unknown }).cause;
      const message = cause instanceof Error ? cause.message : String(caught);
      expect(message).toMatch(/equipment_requests_quantity_positive|check constraint/i);
    });

    const seedLines = (eventId: number, n: number) =>
      database.insert(schema.equipmentRequests).values(
        Array.from({ length: n }, (_, i) => ({
          id: crypto.randomUUID(),
          eventId,
          item: `Line ${i}`,
          quantity: 1,
        }))
      );

    test(`a full event (${EQUIPMENT_MAX_LINES} lines) refuses another add`, async () => {
      const id = await createEvent("approved");
      await seedLines(id, EQUIPMENT_MAX_LINES);
      await expect(
        handleSaveEquipmentLine(
          { eventId: id, item: "Overflow", quantity: 1 },
          coordinator,
          database as never
        )
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await linesOf(id)).toHaveLength(EQUIPMENT_MAX_LINES);
    });

    test("one below the cap still accepts an add", async () => {
      const id = await createEvent("approved");
      await seedLines(id, EQUIPMENT_MAX_LINES - 1);
      await handleSaveEquipmentLine(
        { eventId: id, item: "Last slot", quantity: 1 },
        coordinator,
        database as never
      );
      expect(await linesOf(id)).toHaveLength(EQUIPMENT_MAX_LINES);
    });
  });

  describe("handleRemoveEquipmentLine", () => {
    test("AC4: removes a line", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      await handleRemoveEquipmentLine({ eventId: id, id: line.id }, coordinator, database as never);
      expect(await linesOf(id)).toHaveLength(0);
    });

    test("another event's line is NotFound", async () => {
      const mine = await createEvent("approved");
      const theirs = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: theirs, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      await expect(
        handleRemoveEquipmentLine({ eventId: mine, id: line.id }, coordinator, database as never)
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(await linesOf(theirs)).toHaveLength(1);
    });

    test("refused once the event is no longer editable", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      await database
        .update(schema.eventRequests)
        .set({
          status: "confirmed",
          decidedByCoordinatorId: coordinator.id,
          decidedByCoordinatorName: "Event List Coordinator",
          decidedAt: new Date(),
          confirmedById: coordinator.id,
          confirmedByName: "Event List Coordinator",
          confirmedAt: new Date(),
        })
        .where(eq(schema.eventRequests.id, id));
      await expect(
        handleRemoveEquipmentLine({ eventId: id, id: line.id }, coordinator, database as never)
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await linesOf(id)).toHaveLength(1);
    });

    test("refuses a line holding a reservation instead of cascading it away", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      const [type] = await database
        .insert(schema.equipmentTypes)
        .values({ name: `Guard type ${crypto.randomUUID()}`, quantityHeld: 2 })
        .returning();
      try {
        await database.insert(schema.equipmentReservations).values({
          id: crypto.randomUUID(),
          equipmentRequestId: line.id,
          equipmentTypeId: type.id,
          quantity: 1,
          startsAt: "2030-01-01T10:00:00",
          endsAt: "2030-01-01T12:00:00",
        });
        await expect(
          handleRemoveEquipmentLine({ eventId: id, id: line.id }, coordinator, database as never)
        ).rejects.toThrow("This line holds a reservation and cannot be removed.");
        expect(await linesOf(id)).toHaveLength(1);
      } finally {
        await database
          .delete(schema.equipmentReservations)
          .where(eq(schema.equipmentReservations.equipmentRequestId, line.id));
        await database.delete(schema.equipmentTypes).where(eq(schema.equipmentTypes.id, type.id));
      }
    });
  });

  // ── AC2 ────────────────────────────────────────────────────────────────────────────────────
  describe("approval seeds equipment lines", () => {
    const decide = (id: number, decision: "approved" | "rejected") =>
      handleDecideEventRequest(
        {
          id,
          decision,
          reason: decision === "rejected" ? "Test rejection" : "",
        },
        coordinator,
        database as never
      );

    test("AC2: complete draft lines are copied; blank/half-typed ones are skipped", async () => {
      const id = await createEvent("under_review", {
        equipmentRequirements: [
          { type: "Projector", quantity: 2 },
          { type: "   ", quantity: 1 },
          { type: "Half typed" },
        ] as never,
      });
      await decide(id, "approved");

      const rows = await linesOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        item: "Projector",
        quantity: 2,
        notes: null,
        eventId: id,
      });
    });

    test("AC2: seeded lines are then editable by the coordinator", async () => {
      const id = await createEvent("under_review", {
        equipmentRequirements: [{ type: "Projector", quantity: 1 }] as never,
      });
      await decide(id, "approved");
      const [line] = await linesOf(id);
      await handleSaveEquipmentLine(
        { eventId: id, id: line.id, item: "Projector", quantity: 3 },
        coordinator,
        database as never
      );
      expect((await linesOf(id))[0].quantity).toBe(3);
    });

    test("no draft lines -> no rows", async () => {
      const id = await createEvent("under_review");
      await decide(id, "approved");
      expect(await linesOf(id)).toHaveLength(0);
    });

    test("rejection seeds nothing", async () => {
      const id = await createEvent("under_review", {
        equipmentRequirements: [{ type: "Projector", quantity: 1 }] as never,
      });
      await decide(id, "rejected");
      expect(await linesOf(id)).toHaveLength(0);
    });

    test("deciding twice does not duplicate lines", async () => {
      const id = await createEvent("under_review", {
        equipmentRequirements: [{ type: "Projector", quantity: 1 }] as never,
      });
      await decide(id, "approved");
      await expect(decide(id, "approved")).rejects.toBeInstanceOf(ConflictError);
      expect(await linesOf(id)).toHaveLength(1);
    });

    test("a draft line with quantity 0 is skipped while valid lines are seeded", async () => {
      const id = await createEvent("under_review", {
        equipmentRequirements: [
          { type: "Good", quantity: 2 },
          { type: "Bad", quantity: 0 },
        ] as never,
      });
      await decide(id, "approved");

      const rows = await linesOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ item: "Good", quantity: 2 });
      const [row] = await database
        .select({ status: schema.eventRequests.status })
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, id));
      expect(row.status).toBe("approved");
    });

    // A row saved before the draft cap could carry more lines than the panel allows. The seed
    // slices to the cap so the panel's invariant holds whatever a legacy draft holds.
    test("AC2: a legacy draft over the cap seeds only EQUIPMENT_MAX_LINES", async () => {
      const legacy = Array.from({ length: EQUIPMENT_MAX_LINES + 20 }, (_, i) => ({
        type: `Legacy ${i}`,
        quantity: 1,
      }));
      const id = await createEvent("under_review", {
        equipmentRequirements: legacy,
      });
      await decide(id, "approved");

      const rows = await linesOf(id);
      expect(rows).toHaveLength(EQUIPMENT_MAX_LINES);
      expect(rows.every(row => row.item.startsWith("Legacy "))).toBe(true);
    });
  });

  // ── Row locks & concurrency ───────────────────────────────────────────────────────────────
  describe("row locks serialize submit against edits", () => {
    const seedLines = (eventId: number, n: number) =>
      database.insert(schema.equipmentRequests).values(
        Array.from({ length: n }, (_, i) => ({
          id: crypto.randomUUID(),
          eventId,
          item: `Line ${i}`,
          quantity: 1,
        }))
      );

    // Each test drives a second raw connection holding the event row lock, while the handler
    // under test runs on the pooled drizzle connection. The handler's `FOR UPDATE` must block
    // on that lock; if `loadEditableEvent` drops `.for("update")`, the handler reads the row
    // before the submit commits and its write succeeds, so the assertion flips.
    test("a save racing a submit commit is refused and inserts nothing", async () => {
      const id = await createEvent("approved");
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select id from event_requests where id = $1 for update", [id]);

        const saving = handleSaveEquipmentLine(
          { eventId: id, item: "Projector", quantity: 1 },
          coordinator,
          database as never
        );
        // Give the save time to reach its locked read before the submit commits.
        await sleep(150);
        await client.query(
          "update event_requests set equipment_submitted_at = now() where id = $1",
          [id]
        );
        await client.query("commit");

        await expect(saving).rejects.toBeInstanceOf(ConflictError);
      } finally {
        client.release();
      }
      expect(await linesOf(id)).toHaveLength(0);
    });

    test("a remove racing a submit commit is refused and the line survives", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select id from event_requests where id = $1 for update", [id]);

        const removing = handleRemoveEquipmentLine(
          { eventId: id, id: line.id },
          coordinator,
          database as never
        );
        await sleep(150);
        await client.query(
          "update event_requests set equipment_submitted_at = now() where id = $1",
          [id]
        );
        await client.query("commit");

        await expect(removing).rejects.toBeInstanceOf(ConflictError);
      } finally {
        client.release();
      }
      expect(await linesOf(id)).toHaveLength(1);
    });

    test("two adds racing for the last slot: exactly one wins and the cap holds", async () => {
      const id = await createEvent("approved");
      await seedLines(id, EQUIPMENT_MAX_LINES - 1);

      const results = await Promise.allSettled([
        handleSaveEquipmentLine(
          { eventId: id, item: "First", quantity: 1 },
          coordinator,
          database as never
        ),
        handleSaveEquipmentLine(
          { eventId: id, item: "Second", quantity: 1 },
          coordinator,
          database as never
        ),
      ]);

      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter(r => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictError);
      expect(await linesOf(id)).toHaveLength(EQUIPMENT_MAX_LINES);
    });
  });

  // ── AC5 ────────────────────────────────────────────────────────────────────────────────────
  describe("handleSubmitEquipmentRequest", () => {
    test("AC5: no lines -> ConflictError, timestamp stays null", async () => {
      const id = await createEvent("approved");
      await expect(
        handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never)
      ).rejects.toThrow(EQUIPMENT_NO_LINES_MESSAGE);
      const [row] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, id));
      expect(row.equipmentSubmittedAt).toBeNull();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    test("AC5: with lines -> stamps the event, returns counts, and emails every technical-support user", async () => {
      const id = await createEvent("approved");
      await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1 },
        coordinator,
        database as never
      );

      const result = await handleSubmitEquipmentRequest(
        { eventId: id },
        coordinator,
        database as never
      );

      const techRows = await database
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.role, "technical_support_staff"));
      expect(techRows.length).toBeGreaterThan(0);
      expect(result).toEqual({ lineCount: 1, recipientCount: techRows.length, failedCount: 0 });
      expect(sendEmail).toHaveBeenCalledTimes(techRows.length);
      for (const { email } of techRows) {
        expect(sendEmail).toHaveBeenCalledWith(
          email,
          `Equipment request for event ${id}`,
          expect.anything()
        );
      }
      const [row] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, id));
      expect(row.equipmentSubmittedAt).not.toBeNull();
    });

    test("AC5: every notification rejected still commits the submission and reports the failures", async () => {
      const id = await createEvent("approved");
      await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1 },
        coordinator,
        database as never
      );
      const techRows = await database
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.role, "technical_support_staff"));
      expect(techRows.length).toBeGreaterThan(0);

      // One rejection per recipient, consumed by the call, so no global mock state leaks.
      for (let i = 0; i < techRows.length; i++) {
        sendEmail.mockRejectedValueOnce(new Error("smtp down"));
      }
      const result = await handleSubmitEquipmentRequest(
        { eventId: id },
        coordinator,
        database as never
      );

      expect(result).toEqual({
        lineCount: 1,
        recipientCount: techRows.length,
        failedCount: techRows.length,
      });
      expect(sendEmail).toHaveBeenCalledTimes(techRows.length);

      const [row] = await database
        .select()
        .from(schema.eventRequests)
        .where(eq(schema.eventRequests.id, id));
      expect(row.equipmentSubmittedAt).not.toBeNull();
    });

    test("a second submit is a ConflictError", async () => {
      const id = await createEvent("approved");
      await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      await handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never);
      await expect(
        handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never)
      ).rejects.toBeInstanceOf(ConflictError);
    });

    test("post-submit freeze: saving a line throws ConflictError", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      await handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never);
      await expect(
        handleSaveEquipmentLine(
          { eventId: id, id: line.id, item: "X", quantity: 2 },
          coordinator,
          database as never
        )
      ).rejects.toThrow(/already been submitted/i);
      await expect(
        handleSaveEquipmentLine(
          { eventId: id, item: "Y", quantity: 1 },
          coordinator,
          database as never
        )
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await linesOf(id)).toHaveLength(1);
    });

    test("post-submit freeze: removing a line throws ConflictError", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      await handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never);
      await expect(
        handleRemoveEquipmentLine({ eventId: id, id: line.id }, coordinator, database as never)
      ).rejects.toThrow(/already been submitted/i);
      expect(await linesOf(id)).toHaveLength(1);
    });

    test("two concurrent submits: exactly one wins", async () => {
      const id = await createEvent("approved");
      await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      const results = await Promise.allSettled([
        handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never),
        handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never),
      ]);
      expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    });

    test("unassigned coordinator -> AuthorizationError; non-editable status -> ConflictError", async () => {
      const id = await createEvent("approved");
      await handleSaveEquipmentLine(
        { eventId: id, item: "X", quantity: 1 },
        coordinator,
        database as never
      );
      await expect(
        handleSubmitEquipmentRequest({ eventId: id }, stranger, database as never)
      ).rejects.toBeInstanceOf(AuthorizationError);

      const locked = await createEvent("confirmed");
      await expect(
        handleSubmitEquipmentRequest({ eventId: locked }, coordinator, database as never)
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // ── Visibility ─────────────────────────────────────────────────────────────────────────────
  describe("handleListEvents visibility", () => {
    test("coordinator sees equipment on their event; venue staff do not", async () => {
      const id = await createEvent("approved");
      await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1 },
        coordinator,
        database as never
      );

      const [own] = await handleListEvents({ eventId: id }, coordinator, database as never);
      expect(own.event.equipment).toHaveLength(1);
    });

    test("a technical-support user unconnected to the event is refused", async () => {
      const id = await createEvent("approved");
      await expect(
        handleListEvents({ eventId: id }, techSupport, database as never)
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    // AC5 queue gate: an unassigned `requested` line joins the shared Technical Support work
    // list only once the event is submitted — before that the draft belongs to the Coordinator
    // alone, while a line assigned to a staffer connects them regardless.
    test("AC5: after submit, technical support can see the event (work list)", async () => {
      const id = await createEvent("approved");
      await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1 },
        coordinator,
        database as never
      );
      await handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never);

      const events = await handleListEvents({ eventId: id }, techSupport, database as never);
      expect(events.map(e => e.event.id)).toContain(id);
    });

    test("AC5: before submit, an unassigned requested line connects no technical-support user", async () => {
      const id = await createEvent("approved");
      await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1 },
        coordinator,
        database as never
      );

      await expect(
        handleListEvents({ eventId: id }, techSupport, database as never)
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    // PTR-42: deleting the holder's account nulls the assignment and leaves the reservation
    // holding, so an unassigned `reserved` line must stay reachable — otherwise no member could
    // ever release its units. Assigned lines still connect only their assignee (next test).
    test("AC5: a reserved unassigned line on a submitted event connects technical support", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1 },
        coordinator,
        database as never
      );
      await handleSubmitEquipmentRequest({ eventId: id }, coordinator, database as never);
      await database
        .update(schema.equipmentRequests)
        .set({ arrangementStatus: "reserved" })
        .where(eq(schema.equipmentRequests.id, line.id));

      const events = await handleListEvents({ eventId: id }, techSupport, database as never);
      expect(events.map(e => e.event.id)).toContain(id);
      expect(events[0]?.event.equipment?.[0]).toMatchObject({
        id: line.id,
        arrangeable: true,
      });
    });

    test("AC5: a line assigned to another staffer connects only that staffer", async () => {
      const id = await createEvent("approved");
      const line = await handleSaveEquipmentLine(
        { eventId: id, item: "Projector", quantity: 1 },
        coordinator,
        database as never
      );
      await database
        .update(schema.equipmentRequests)
        .set({ assignedStaffId: otherTechSupport.id })
        .where(eq(schema.equipmentRequests.id, line.id));

      await expect(
        handleListEvents({ eventId: id }, techSupport, database as never)
      ).rejects.toBeInstanceOf(AuthorizationError);
      const events = await handleListEvents({ eventId: id }, otherTechSupport, database as never);
      expect(events.map(e => e.event.id)).toContain(id);
    });
  });
});
