// Mirrors equipment-arrangement.test.ts: a local node-postgres drizzle instance, not the app's
// `#/db`, with the mailer mocked as venue-requests.test.ts does.
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { render } from "@react-email/components";
import type { ReactElement } from "react";

import * as schema from "#/db/schema";
import { runSeed } from "../../scripts/seed";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  CONFIRMATION_REFUSAL_HEADING,
  MULTIPLE_VENUE_BOOKINGS_MESSAGE,
} from "#/features/events/confirmation";
import { handleConfirmEvent } from "#/features/events/confirm.server";
import { handleListEvents } from "#/features/events/records.server";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi
    .fn<(to: string, subject: string, react: ReactElement) => Promise<unknown>>()
    .mockResolvedValue({ id: "test-email" }),
}));

vi.mock("#/lib/mailer.server", () => ({
  createMailer: vi.fn<() => null>(() => null),
  getMailer: vi.fn<() => null>(() => null),
  sendEmail,
}));

type Database = ReturnType<typeof drizzle<typeof schema>>;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const actor = (id: string, role: string, name = id): SessionUser => ({
  id,
  role,
  name,
  email: `${id}@x.test`,
});

const coordinator = actor("seed-coordinator-1", "event_coordinator", "Event List Coordinator");
const stranger = actor("confirmation-other-coordinator", "event_coordinator");
const organiser = actor("test-user-2", "event_organiser");
const otherOrganiser = actor("confirmation-other-organiser", "event_organiser");

describe("confirming an event (PTR-24)", () => {
  let pool: Pool;
  let database: Database;
  let venueId: number;
  let venueName: string;
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
          email: "confirmation.other.coordinator@example.com",
          emailVerified: true,
          role: "event_coordinator",
        },
        {
          id: otherOrganiser.id,
          name: "Other Organiser",
          email: "confirmation.other.organiser@example.com",
          emailVerified: true,
          role: "event_organiser",
        },
      ])
      .onConflictDoNothing();

    const [venue] = await database.select().from(schema.venues).limit(1);
    venueId = venue.id;
    venueName = venue.name;
  });

  afterAll(async () => {
    await database
      .delete(schema.user)
      .where(inArray(schema.user.id, [stranger.id, otherOrganiser.id]));
    await pool.end();
  });

  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ id: "test-email" });
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

  async function createEvent(
    status: (typeof schema.eventRequestStatus.enumValues)[number] = "approved",
    // PTR-43 stamp: Technical Support marked the equipment arrangements complete.
    equipmentCompleted = true
  ) {
    const decided = !["draft", "submitted", "under_review", "awaiting_organiser"].includes(status);
    const confirmed = status === "confirmed";
    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status,
        submittedAt: new Date(),
        assignedCoordinatorId: coordinator.id,
        assignedAt: new Date(),
        ...(decided
          ? {
              decisionReason: status === "rejected" ? "Not suitable" : null,
              decidedByCoordinatorId: coordinator.id,
              decidedByCoordinatorName: coordinator.name,
              decidedAt: new Date(),
            }
          : {}),
        ...(confirmed
          ? {
              confirmedById: coordinator.id,
              confirmedByName: coordinator.name,
              confirmedAt: new Date("2030-01-01T00:00:00Z"),
            }
          : {}),
        equipmentArrangementsCompletedAt: equipmentCompleted ? new Date() : null,
        eventName: `Confirmation test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
        expectedAttendance: 10,
        eventType: "Conference",
      })
      .returning({ id: schema.eventRequests.id });
    created.push(row.id);
    return row.id;
  }

  function createBooking(
    eventId: number,
    status: "pending" | "approved" | "rejected" | "released" | "withdrawn" = "approved"
  ) {
    return database.insert(schema.venueRequests).values({
      id: crypto.randomUUID(),
      eventId,
      venueId,
      requestedById: coordinator.id,
      // A window in a distant year per event keeps the overlap constraint from tripping.
      startsAt: `${2040 + created.length}-03-10 09:00:00`,
      endsAt: `${2040 + created.length}-03-10 12:30:00`,
      status,
      ...(status === "rejected" ? { rejectionReason: "Fully booked" } : {}),
      ...(status === "released" ? { releaseReason: "No longer needed" } : {}),
    });
  }

  async function createLine(
    eventId: number,
    item: string,
    arrangementStatus: "requested" | "reserved" | "not_required" | "unavailable",
    quantity = 1
  ) {
    await database.insert(schema.equipmentRequests).values({
      id: crypto.randomUUID(),
      eventId,
      item,
      quantity,
      arrangementStatus,
      ...(arrangementStatus === "unavailable" ? { unavailableReason: "Loaned out" } : {}),
    });
  }

  const readEvent = async (id: number) =>
    (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0];

  const confirm = (eventId: number, as: SessionUser = coordinator) =>
    handleConfirmEvent({ id: eventId }, as, database as never);

  const refusal = async (eventId: number, as: SessionUser = coordinator) => {
    const error = await confirm(eventId, as).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    return (error as Error).message;
  };

  // ── AC1 ────────────────────────────────────────────────────────────────────────────────────
  describe("the gate", () => {
    test("confirms an approved event whose arrangements are in place", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved", 2);
      await createLine(eventId, "Microphone", "not_required");

      const confirmed = await confirm(eventId);

      expect(confirmed.status).toBe("confirmed");
      expect((await readEvent(eventId)).status).toBe("confirmed");
    });

    test("confirms from planning too", async () => {
      const eventId = await createEvent("planning");
      await createBooking(eventId);

      expect((await confirm(eventId)).status).toBe("confirmed");
    });

    // AC5
    test("confirms with no equipment lines, on the venue booking alone", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);

      expect((await confirm(eventId)).status).toBe("confirmed");
    });

    test("still requires the venue booking when there are no equipment lines", async () => {
      const eventId = await createEvent();

      const message = await refusal(eventId);

      expect(message).toContain("no approved venue booking");
      expect(message).not.toContain("equipment");
    });
  });

  // ── AC2 ────────────────────────────────────────────────────────────────────────────────────
  describe("refusals", () => {
    test.each(["pending", "rejected", "released", "withdrawn"] as const)(
      "refuses without an approved booking when the only request is %s, and leaves the event untouched",
      async requestStatus => {
        const eventId = await createEvent();
        await createBooking(eventId, requestStatus);

        const message = await refusal(eventId);

        expect(message.startsWith(CONFIRMATION_REFUSAL_HEADING)).toBe(true);
        expect(message).toContain("no approved venue booking");
        const row = await readEvent(eventId);
        expect(row.status).toBe("approved");
        expect(row.confirmedAt).toBeNull();
        expect(row.confirmedById).toBeNull();
      }
    );

    test("refuses more than one approved booking and leaves the event untouched", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      // A distant second window keeps the overlap constraint from tripping.
      await database.insert(schema.venueRequests).values({
        id: crypto.randomUUID(),
        eventId,
        venueId,
        requestedById: coordinator.id,
        startsAt: "2042-06-10 09:00:00",
        endsAt: "2042-06-10 12:30:00",
        status: "approved",
      });

      const message = await refusal(eventId);

      expect(message).toContain(MULTIPLE_VENUE_BOOKINGS_MESSAGE);
      expect((await readEvent(eventId)).status).toBe("approved");
    });

    test("refuses while equipment is outstanding and names only the outstanding lines", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "requested");
      await createLine(eventId, "Microphone", "unavailable");
      await createLine(eventId, "Speaker", "reserved");

      const message = await refusal(eventId);

      expect(message).toContain("Projector");
      expect(message).toContain("Microphone");
      expect(message).not.toContain("Speaker");
      expect((await readEvent(eventId)).status).toBe("approved");
    });

    // PTR-43: every line arranged is not enough until Technical Support marks it complete.
    test("refuses arranged equipment that Technical Support has not marked complete", async () => {
      const eventId = await createEvent("approved", false);
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved");

      const message = await refusal(eventId);

      expect(message).toContain("Technical Support has not marked the equipment arrangements");
      expect((await readEvent(eventId)).status).toBe("approved");
    });

    test("names the venue and the equipment in one refusal", async () => {
      const eventId = await createEvent();
      await createLine(eventId, "Projector", "requested");

      const message = await refusal(eventId);

      expect(message).toContain("no approved venue booking");
      expect(message).toContain("Projector");
    });

    test.each([
      "submitted",
      "under_review",
      "awaiting_organiser",
      "rejected",
      "cancelled",
      "completed",
    ] as const)("refuses a %s event and names its status", async status => {
      const eventId = await createEvent(status);
      await createBooking(eventId);

      const message = await refusal(eventId);

      expect(message).toContain(`status is ${status.replaceAll("_", " ")}`);
      expect((await readEvent(eventId)).status).toBe(status);
    });

    test("a second confirmation is refused and does not overwrite the first record", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await confirm(eventId);
      const first = await readEvent(eventId);

      const message = await refusal(eventId);

      expect(message).toContain("status is confirmed");
      const after = await readEvent(eventId);
      expect(after.confirmedAt).toEqual(first.confirmedAt);
      expect(after.confirmedById).toBe(first.confirmedById);
    });
  });

  // ── AC1 security ───────────────────────────────────────────────────────────────────────────
  describe("who may confirm", () => {
    test("refuses a Coordinator who is not assigned to the event", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);

      await expect(confirm(eventId, stranger)).rejects.toBeInstanceOf(AuthorizationError);
      expect((await readEvent(eventId)).status).toBe("approved");
    });

    test("treats a missing event the same way", async () => {
      await expect(confirm(987_654_321)).rejects.toMatchObject({
        name: "AuthorizationError",
        message: "Forbidden",
      });
    });
  });

  // ── AC4 ────────────────────────────────────────────────────────────────────────────────────
  describe("recording and notifying", () => {
    test("records the acting Coordinator and the time, and keeps the approval attribution", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const before = await readEvent(eventId);

      const started = Date.now();
      await confirm(eventId);
      const row = await readEvent(eventId);

      expect(row.confirmedById).toBe(coordinator.id);
      expect(row.confirmedByName).toBe(coordinator.name);
      expect(row.confirmedAt?.getTime()).toBeGreaterThanOrEqual(started - 1000);
      expect(row.decidedByCoordinatorId).toBe(before.decidedByCoordinatorId);
      expect(row.decidedAt).toEqual(before.decidedAt);
    });

    test("emails the Organiser after the commit with the venue, time and equipment", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved", 2);

      await confirm(eventId);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, body] = sendEmail.mock.calls[0];
      const [organiserRow] = await database
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, organiser.id));
      expect(to).toBe(organiserRow.email);
      expect(subject).toMatch(/^Event confirmed: Confirmation test /);
      const html = await render(body);
      expect(html).toContain(venueName);
      expect(html).toContain("Projector");
      expect(html).toContain("09:00");
    });

    test("keeps the confirmation when the email fails", async () => {
      sendEmail.mockRejectedValue(new Error("smtp is down"));
      const eventId = await createEvent();
      await createBooking(eventId);

      await expect(confirm(eventId)).resolves.toMatchObject({ status: "confirmed" });
      expect((await readEvent(eventId)).status).toBe("confirmed");
    });

    test("sends nothing when the confirmation is refused", async () => {
      const eventId = await createEvent();

      await refusal(eventId);

      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  // ── AC4 data integrity ─────────────────────────────────────────────────────────────────────
  describe("the database", () => {
    test("the DB CHECK rejects a confirmed row with no confirmer", async () => {
      const eventId = await createEvent();

      await expect(
        database
          .update(schema.eventRequests)
          .set({ status: "confirmed" })
          .where(eq(schema.eventRequests.id, eventId))
      ).rejects.toThrow("Failed query");
      await expect(
        database
          .update(schema.eventRequests)
          .set({
            status: "confirmed",
            confirmedById: coordinator.id,
            confirmedByName: "  ",
            confirmedAt: new Date(),
          })
          .where(eq(schema.eventRequests.id, eventId))
      ).rejects.toThrow("Failed query");
    });

    test("the DB CHECK rejects a confirmer on an event that is not confirmed", async () => {
      const eventId = await createEvent();

      await expect(
        database
          .update(schema.eventRequests)
          .set({
            confirmedById: coordinator.id,
            confirmedByName: coordinator.name,
            confirmedAt: new Date(),
          })
          .where(eq(schema.eventRequests.id, eventId))
      ).rejects.toThrow("Failed query");
    });

    test("accepts a complete confirmed row, and completion keeps the record", async () => {
      const eventId = await createEvent("confirmed");

      await database
        .update(schema.eventRequests)
        .set({ status: "completed" })
        .where(eq(schema.eventRequests.id, eventId));

      const row = await readEvent(eventId);
      expect(row.status).toBe("completed");
      expect(row.confirmedById).toBe(coordinator.id);
    });
  });

  // ── AC2 concurrency ────────────────────────────────────────────────────────────────────────
  describe("concurrency", () => {
    test("a confirmation racing a booking release is refused", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const [booking] = await database
        .select()
        .from(schema.venueRequests)
        .where(eq(schema.venueRequests.eventId, eventId));

      // Hold the booking's row lock the way a release does, then start confirming.
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select id from venue_requests where id = $1 for update", [booking.id]);

        const pending = confirm(eventId).catch((caught: unknown) => caught);
        await sleep(300);
        await client.query(
          "update venue_requests set status = 'released', release_reason = 'No longer needed' where id = $1",
          [booking.id]
        );
        await client.query("commit");

        const error = await pending;
        expect(error).toBeInstanceOf(ConflictError);
        expect((error as Error).message).toContain("no approved venue booking");
      } finally {
        client.release();
      }
      expect((await readEvent(eventId)).status).toBe("approved");
    });

    test("a confirmation racing an equipment change re-reads the lines", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved");
      const [line] = await database
        .select()
        .from(schema.equipmentRequests)
        .where(eq(schema.equipmentRequests.eventId, eventId));

      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select id from equipment_requests where id = $1 for update", [line.id]);

        const pending = confirm(eventId).catch((caught: unknown) => caught);
        await sleep(300);
        await client.query(
          "update equipment_requests set arrangement_status = 'requested' where id = $1",
          [line.id]
        );
        await client.query("commit");

        const error = await pending;
        expect(error).toBeInstanceOf(ConflictError);
        expect((error as Error).message).toContain("Projector");
      } finally {
        client.release();
      }
      expect((await readEvent(eventId)).status).toBe("approved");
    });
  });

  // ── AC3 ────────────────────────────────────────────────────────────────────────────────────
  describe("what the Organiser and Coordinator see", () => {
    test("the Organiser reads the confirmed venue, time, equipment and who confirmed", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved");
      await confirm(eventId);

      const [entry] = await handleListEvents({ eventId }, organiser, database as never);

      expect(entry.access).toBe("organiser");
      expect(entry.event.status).toBe("confirmed");
      expect(entry.event.confirmation).toMatchObject({
        confirmedByName: coordinator.name,
        venue: { name: venueName, startTime: "09:00", endTime: "12:30" },
      });
      expect(entry.event.equipment).toMatchObject([
        { item: "Projector", arrangementStatus: "reserved" },
      ]);
    });

    test("does not show the Organiser Technical Support notes", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "not_required");
      await database
        .update(schema.equipmentRequests)
        .set({ arrangementNotes: "Internal note" })
        .where(eq(schema.equipmentRequests.eventId, eventId));
      await confirm(eventId);

      const [entry] = await handleListEvents({ eventId }, organiser, database as never);

      expect(JSON.stringify(entry)).not.toContain("Internal note");
    });

    test("an event that is not confirmed carries no confirmation", async () => {
      const eventId = await createEvent();

      const [entry] = await handleListEvents({ eventId }, organiser, database as never);

      expect(entry.event.confirmation).toBeNull();
    });

    test("refuses another Organiser's confirmed event", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await confirm(eventId);

      await expect(
        handleListEvents({ eventId }, otherOrganiser, database as never)
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  // ── AC6 ────────────────────────────────────────────────────────────────────────────────────
  describe("after confirmation", () => {
    test("releasing the booking leaves the event confirmed and says the booking is gone", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await confirm(eventId);

      await database
        .update(schema.venueRequests)
        .set({ status: "released", releaseReason: "No longer needed" })
        .where(eq(schema.venueRequests.eventId, eventId));

      const row = await readEvent(eventId);
      expect(row.status).toBe("confirmed");
      expect(row.confirmedById).toBe(coordinator.id);
      const [entry] = await handleListEvents({ eventId }, coordinator, database as never);
      expect(entry.event.status).toBe("confirmed");
      expect(entry.event.confirmation?.venue).toBeNull();
    });

    test("changing an equipment line leaves the event confirmed", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved");
      await confirm(eventId);

      await database
        .update(schema.equipmentRequests)
        .set({ arrangementStatus: "requested" })
        .where(eq(schema.equipmentRequests.eventId, eventId));

      expect((await readEvent(eventId)).status).toBe("confirmed");
    });
  });
});
