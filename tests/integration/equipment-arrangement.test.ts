// Mirrors equipment-requests.test.ts: a local node-postgres drizzle instance, not the app's `#/db`
// (which is configured with the bun-sql driver and does not accept this codebase's query shapes
// in a test context).
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { runSeed } from "../../scripts/seed";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { handleUpdateArrangement } from "#/features/equipment-requests/equipment.server";
import {
  ARRANGEMENT_REASON_MESSAGE,
  EQUIPMENT_NOTES_MAX,
  EQUIPMENT_NOTES_MESSAGE,
} from "#/features/equipment-requests/schema";
import { handleListEvents } from "#/features/events/records.server";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const actor = (id: string, role: string): SessionUser => ({
  id,
  role,
  name: id,
  email: `${id}@x.test`,
});

const coordinator = actor("seed-coordinator-1", "event_coordinator");
const stranger = actor("arrangement-other-coordinator", "event_coordinator");
const organiser = actor("test-user-2", "event_organiser");
const techSupport = actor("seed-tech-support-1", "technical_support_staff");
const otherTechSupport = actor("arrangement-other-tech-support", "technical_support_staff");

describe("equipment arrangement handler (PTR-39)", () => {
  let pool: Pool;
  let database: Database;
  const created: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });
    await runSeed(database);

    await database
      .insert(schema.user)
      .values([
        {
          id: stranger.id,
          name: "Other Coordinator",
          email: "arrangement.other.coordinator@example.com",
          emailVerified: true,
          role: "event_coordinator",
        },
        {
          id: otherTechSupport.id,
          name: "Other Tech Support",
          email: "arrangement.other.tech.support@example.com",
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
    if (created.length === 0) return;
    await database
      .delete(schema.equipmentRequests)
      .where(inArray(schema.equipmentRequests.eventId, created));
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });

  /** An approved event whose Coordinator has already submitted its equipment. */
  async function createSubmittedEvent(submitted = true) {
    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status: "approved",
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
        decidedByCoordinatorId: coordinator.id,
        decidedByCoordinatorName: "Event List Coordinator",
        decidedAt: new Date(),
        equipmentSubmittedAt: submitted ? new Date() : null,
        eventName: `Arrangement test ${crypto.randomUUID()}`,
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
    created.push(row.id);
    return row.id;
  }

  async function createLine(
    eventId: number,
    extra: Partial<typeof schema.equipmentRequests.$inferInsert> = {}
  ) {
    const [line] = await database
      .insert(schema.equipmentRequests)
      .values({
        id: crypto.randomUUID(),
        eventId,
        item: "Projector",
        quantity: 2,
        ...extra,
      })
      .returning();
    return line;
  }

  const lineRow = async (id: string) => {
    const [row] = await database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.id, id));
    return row;
  };

  const update = (input: Record<string, unknown>, as: SessionUser = techSupport) =>
    handleUpdateArrangement(input, as, database as never);

  async function arrangedEvent() {
    const eventId = await createSubmittedEvent();
    const unavailable = await createLine(eventId, { item: "Projector" });
    const noted = await createLine(eventId, { item: "Microphone" });
    await update({
      eventId,
      id: unavailable.id,
      arrangementStatus: "unavailable",
      unavailableReason: "Loaned out",
    });
    await update({
      eventId,
      id: noted.id,
      arrangementNotes: "Battery pack included",
    });
    return eventId;
  }

  // ── AC1 ────────────────────────────────────────────────────────────────────────────────────
  describe("the work list", () => {
    test("lists an event whose equipment was submitted to Technical Support", async () => {
      const eventId = await createSubmittedEvent();
      await createLine(eventId);

      const events = await handleListEvents({}, techSupport, database as never);

      expect(events.map(entry => entry.event.id)).toContain(eventId);
      expect(events.find(entry => entry.event.id === eventId)?.access).toBe("technical_support");
    });

    test("records the updating staff member on the line so the event stays on their list", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);

      await update({ eventId, id: line.id, arrangementStatus: "not_required" });

      expect((await lineRow(line.id)).assignedStaffId).toBe(techSupport.id);
      const events = await handleListEvents({ eventId }, techSupport, database as never);
      expect(events.map(entry => entry.event.id)).toEqual([eventId]);
    });

    test("drops the event from a colleague's list once no open line remains", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);
      await update({ eventId, id: line.id, arrangementStatus: "not_required" });

      await expect(
        handleListEvents({ eventId }, otherTechSupport, database as never)
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  // ── AC2 ────────────────────────────────────────────────────────────────────────────────────
  describe("the request detail", () => {
    test("gives Technical Support every line of the event, including lines held by a colleague", async () => {
      const eventId = await createSubmittedEvent();
      await createLine(eventId, { item: "Projector" });
      await createLine(eventId, {
        item: "Microphone",
        assignedStaffId: otherTechSupport.id,
        arrangementStatus: "not_required",
      });

      const [entry] = await handleListEvents({ eventId }, techSupport, database as never);

      expect(entry.event.equipment?.map(line => line.item).toSorted()).toEqual([
        "Microphone",
        "Projector",
      ]);
      expect(entry.event).toMatchObject({
        eventDate: "2030-01-01",
        startTime: "09:00",
        endTime: "17:00",
      });
    });

    test("marks which lines the member can arrange and which a colleague holds", async () => {
      const eventId = await createSubmittedEvent();
      await createLine(eventId, { item: "Open" });
      await createLine(eventId, {
        item: "Mine",
        assignedStaffId: techSupport.id,
        arrangementStatus: "not_required",
      });
      await createLine(eventId, {
        item: "Theirs",
        assignedStaffId: otherTechSupport.id,
        arrangementStatus: "not_required",
      });

      const [entry] = await handleListEvents({ eventId }, techSupport, database as never);
      const arrangeable = new Map(
        entry.event.equipment?.map(line => [line.item, line.arrangeable])
      );

      expect(Object.fromEntries(arrangeable)).toEqual({
        Open: true,
        Mine: true,
        Theirs: false,
      });
    });

    test("does not mark lines for the Coordinator", async () => {
      const eventId = await createSubmittedEvent();
      await createLine(eventId);

      const [entry] = await handleListEvents({ eventId }, coordinator, database as never);

      expect(entry.event.equipment?.[0]).not.toHaveProperty("arrangeable");
      expect(entry.event.equipment?.[0]).not.toHaveProperty("assignedStaffName");
    });

    test("names who holds each line for Technical Support only", async () => {
      const eventId = await createSubmittedEvent();
      await createLine(eventId, { item: "Open" });
      await createLine(eventId, {
        item: "Theirs",
        assignedStaffId: otherTechSupport.id,
        arrangementStatus: "not_required",
      });

      const names = async (as: SessionUser) => {
        const [entry] = await handleListEvents({ eventId }, as, database as never);
        return entry.event.equipment?.map(line => [line.item, line.assignedStaffName]);
      };

      expect(Object.fromEntries((await names(techSupport)) ?? [])).toEqual({
        Open: null,
        Theirs: "Other Tech Support",
      });
      const others = await Promise.all(
        [coordinator, organiser].map(viewer =>
          handleListEvents({ eventId }, viewer, database as never)
        )
      );
      for (const [entry] of others) {
        for (const line of entry.event.equipment ?? []) {
          expect(line).not.toHaveProperty("assignedStaffName");
        }
      }
    });
  });

  // ── AC3 ────────────────────────────────────────────────────────────────────────────────────
  describe("setting the arrangement state", () => {
    test("sets a line to not required", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);

      await update({ eventId, id: line.id, arrangementStatus: "not_required" });

      expect(await lineRow(line.id)).toMatchObject({
        arrangementStatus: "not_required",
        unavailableReason: null,
      });
    });

    test("sets a line back to requested", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);
      await update({ eventId, id: line.id, arrangementStatus: "not_required" });

      await update({ eventId, id: line.id, arrangementStatus: "requested" });

      expect((await lineRow(line.id)).arrangementStatus).toBe("requested");
    });

    test("saves unavailable with its reason", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);

      await update({
        eventId,
        id: line.id,
        arrangementStatus: "unavailable",
        unavailableReason: "  Loaned out to another event  ",
      });

      expect(await lineRow(line.id)).toMatchObject({
        arrangementStatus: "unavailable",
        unavailableReason: "Loaned out to another event",
      });
    });

    test("refuses unavailable without a reason and leaves the line unchanged", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);

      await Promise.all(
        [undefined, "", "   "].map(unavailableReason =>
          expect(
            update({
              eventId,
              id: line.id,
              arrangementStatus: "unavailable",
              unavailableReason,
            })
          ).rejects.toThrow(ARRANGEMENT_REASON_MESSAGE)
        )
      );

      expect(await lineRow(line.id)).toMatchObject({
        arrangementStatus: "requested",
        unavailableReason: null,
        assignedStaffId: null,
      });
    });

    test("clears the reason when the line leaves unavailable", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);
      await update({
        eventId,
        id: line.id,
        arrangementStatus: "unavailable",
        unavailableReason: "Loaned out",
      });

      await update({ eventId, id: line.id, arrangementStatus: "requested" });

      expect(await lineRow(line.id)).toMatchObject({
        arrangementStatus: "requested",
        unavailableReason: null,
      });
    });

    test("the DB CHECK rejects an unavailable row with no reason", async () => {
      const eventId = await createSubmittedEvent();
      let caught: unknown;
      try {
        await createLine(eventId, {
          arrangementStatus: "unavailable",
          unavailableReason: "  ",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const cause = (caught as { cause?: unknown }).cause;
      const message = cause instanceof Error ? cause.message : String(caught);
      expect(message).toMatch(/equipment_requests_unavailable_has_reason|check constraint/i);
    });
  });

  describe("the DB CHECK on whitespace-only reasons", () => {
    test.each(["\t", "\n"])("rejects unavailable with reason %j", async reason => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);
      const error = await database
        .update(schema.equipmentRequests)
        .set({ arrangementStatus: "unavailable", unavailableReason: reason })
        .where(eq(schema.equipmentRequests.id, line.id))
        .then(
          () => null,
          (caught: unknown) => caught
        );
      const cause = (error as { cause?: unknown } | null)?.cause;
      expect(String(cause instanceof Error ? cause.message : error)).toMatch(
        /equipment_requests_unavailable_has_reason|check constraint/i
      );
      expect((await lineRow(line.id)).arrangementStatus).toBe("requested");
    });

    test("the handler refuses a zero-width-space reason", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);

      await expect(
        update({
          eventId,
          id: line.id,
          arrangementStatus: "unavailable",
          unavailableReason: "\u200B",
        })
      ).rejects.toThrow(ARRANGEMENT_REASON_MESSAGE);

      expect((await lineRow(line.id)).arrangementStatus).toBe("requested");
    });
  });

  describe("adding notes", () => {
    test("saves notes without changing the state", async () => {
      const eventId = await createSubmittedEvent();
      // A line only reaches `not_required` through an update, which also assigns it to the member.
      const line = await createLine(eventId, {
        arrangementStatus: "not_required",
        assignedStaffId: techSupport.id,
      });

      await update({
        eventId,
        id: line.id,
        arrangementNotes: "  HDMI adapter from store B  ",
      });

      expect(await lineRow(line.id)).toMatchObject({
        arrangementStatus: "not_required",
        arrangementNotes: "HDMI adapter from store B",
      });
    });

    test("clears notes", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId, { arrangementNotes: "Old note" });

      await update({ eventId, id: line.id, arrangementNotes: "" });

      expect((await lineRow(line.id)).arrangementNotes).toBeNull();
    });

    test("refuses notes over the limit and leaves the line unchanged", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId, { arrangementNotes: "Kept" });

      await expect(
        update({
          eventId,
          id: line.id,
          arrangementNotes: "x".repeat(EQUIPMENT_NOTES_MAX + 1),
        })
      ).rejects.toThrow(EQUIPMENT_NOTES_MESSAGE);

      expect((await lineRow(line.id)).arrangementNotes).toBe("Kept");
    });

    test("leaves the Coordinator's own line note untouched", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId, { notes: "Coordinator note" });

      await update({
        eventId,
        id: line.id,
        arrangementStatus: "requested",
        arrangementNotes: "Technical Support note",
      });

      expect(await lineRow(line.id)).toMatchObject({
        notes: "Coordinator note",
        arrangementNotes: "Technical Support note",
      });
    });
  });

  describe("a line holding a reservation", () => {
    test("refuses to move a line that holds a reservation and leaves it untouched", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId, {
        arrangementStatus: "reserved",
        assignedStaffId: techSupport.id,
      });

      await expect(
        update({ eventId, id: line.id, arrangementStatus: "not_required" })
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        update({
          eventId,
          id: line.id,
          arrangementStatus: "unavailable",
          unavailableReason: "Loaned out",
        })
      ).rejects.toBeInstanceOf(ConflictError);

      expect(await lineRow(line.id)).toMatchObject({
        arrangementStatus: "reserved",
        unavailableReason: null,
      });
    });

    test("still lets notes be added to a reserved line", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId, {
        arrangementStatus: "reserved",
        assignedStaffId: techSupport.id,
      });

      await update({
        eventId,
        id: line.id,
        arrangementNotes: "Collect from store B",
      });

      expect(await lineRow(line.id)).toMatchObject({
        arrangementStatus: "reserved",
        arrangementNotes: "Collect from store B",
      });
    });

    test("moves the line once the reservation is released", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId, {
        arrangementStatus: "reserved",
        assignedStaffId: techSupport.id,
      });
      // PTR-42 releases a reservation by returning the line to requested; it is not built yet.
      await database
        .update(schema.equipmentRequests)
        .set({ arrangementStatus: "requested" })
        .where(eq(schema.equipmentRequests.id, line.id));

      await update({ eventId, id: line.id, arrangementStatus: "not_required" });

      expect((await lineRow(line.id)).arrangementStatus).toBe("not_required");
    });

    // A second raw connection holds the line lock while the handler runs on the pool. The
    // handler's `FOR UPDATE` must block on it and re-read the row after the reservation commits;
    // a handler that read the row first would see `requested` and overwrite the reservation.
    test("an update racing a reservation commit is refused", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId, {
        assignedStaffId: techSupport.id,
      });
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select id from equipment_requests where id = $1 for update", [line.id]);

        const updating = update({
          eventId,
          id: line.id,
          arrangementStatus: "not_required",
        });
        // Give the update time to reach its locked read before the reservation commits.
        await sleep(150);
        await client.query(
          "update equipment_requests set arrangement_status = 'reserved' where id = $1",
          [line.id]
        );
        await client.query("commit");

        await expect(updating).rejects.toBeInstanceOf(ConflictError);
      } finally {
        client.release();
      }
      expect((await lineRow(line.id)).arrangementStatus).toBe("reserved");
    });
  });

  describe("who may update which line", () => {
    test("two members claiming the same unclaimed line: one wins, the other is refused", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId);

      const results = await Promise.allSettled([
        update({ eventId, id: line.id, arrangementStatus: "not_required" }, techSupport),
        update({ eventId, id: line.id, arrangementStatus: "not_required" }, otherTechSupport),
      ]);

      const fulfilled = results.findIndex(result => result.status === "fulfilled");
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(result => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(AuthorizationError);
      expect((await lineRow(line.id)).assignedStaffId).toBe(
        [techSupport, otherTechSupport][fulfilled].id
      );
    });

    test("refuses a line on an event that has not been submitted", async () => {
      const eventId = await createSubmittedEvent(false);
      const line = await createLine(eventId);

      await expect(
        update({ eventId, id: line.id, arrangementStatus: "not_required" })
      ).rejects.toBeInstanceOf(AuthorizationError);

      expect(await lineRow(line.id)).toMatchObject({
        arrangementStatus: "requested",
        assignedStaffId: null,
      });
    });

    test("refuses a line held by a colleague", async () => {
      const eventId = await createSubmittedEvent();
      const held = await createLine(eventId, {
        assignedStaffId: otherTechSupport.id,
      });
      // A second, open line keeps the event connected to the actor, so the refusal is the line's.
      await createLine(eventId, { item: "Microphone" });

      await expect(
        update({ eventId, id: held.id, arrangementStatus: "not_required" })
      ).rejects.toBeInstanceOf(AuthorizationError);

      expect((await lineRow(held.id)).arrangementStatus).toBe("requested");
    });

    test("refuses a member who is not connected to the event at all", async () => {
      const eventId = await createSubmittedEvent();
      const line = await createLine(eventId, {
        assignedStaffId: otherTechSupport.id,
      });

      await expect(
        update({ eventId, id: line.id, arrangementNotes: "Sneaky" })
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    test("treats a line of another event as not found", async () => {
      const eventId = await createSubmittedEvent();
      await createLine(eventId);
      const otherEventId = await createSubmittedEvent();
      const foreign = await createLine(otherEventId);

      await expect(
        update({ eventId, id: foreign.id, arrangementStatus: "not_required" })
      ).rejects.toBeInstanceOf(NotFoundError);

      expect((await lineRow(foreign.id)).arrangementStatus).toBe("requested");
    });

    test("treats a missing line as not found", async () => {
      const eventId = await createSubmittedEvent();
      await createLine(eventId);

      await expect(
        update({
          eventId,
          id: crypto.randomUUID(),
          arrangementStatus: "not_required",
        })
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── AC4 ────────────────────────────────────────────────────────────────────────────────────
  describe("what the Coordinator sees", () => {
    test("shows the Coordinator the state, notes and reason Technical Support saved", async () => {
      const eventId = await arrangedEvent();

      const [entry] = await handleListEvents({ eventId }, coordinator, database as never);
      const byItem = new Map(entry.event.equipment?.map(line => [line.item, line]));

      expect(byItem.get("Projector")).toMatchObject({
        arrangementStatus: "unavailable",
        unavailableReason: "Loaned out",
      });
      expect(byItem.get("Microphone")).toMatchObject({
        arrangementStatus: "requested",
        arrangementNotes: "Battery pack included",
      });
    });

    test("does not show the notes to the organiser", async () => {
      const eventId = await arrangedEvent();

      const [entry] = await handleListEvents({ eventId }, organiser, database as never);

      const projector = entry.event.equipment?.find(line => line.item === "Projector");
      expect(projector).toMatchObject({ arrangementStatus: "unavailable" });
      expect(projector).not.toHaveProperty("arrangementNotes");
      expect(projector).not.toHaveProperty("unavailableReason");
    });

    test("refuses a Coordinator who is not assigned to the event", async () => {
      const eventId = await arrangedEvent();

      await expect(
        handleListEvents({ eventId }, stranger, database as never)
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });
});
