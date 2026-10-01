// oxlint-disable node/no-process-env
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { ReactElement } from "react";

import * as schema from "#/db/schema";
import type { SessionUser } from "#/features/auth/session";
import { handleConfirmEventRequest } from "#/features/coordination/assignments.server";
import {
  handleCompleteArrangements,
  handleRecordUnavailable,
  handleRemoveEquipmentLine,
  handleSaveEquipmentLine,
  handleUpdateArrangement,
} from "#/features/equipment-requests/equipment.server";
import {
  handleReleaseEquipmentReservation,
  handleReserveEquipment,
} from "#/features/equipment-requests/reservations.server";
import { ARRANGEMENT_RESERVED_MESSAGE } from "#/features/equipment-requests/schema";
import { handleListEvents } from "#/features/events/records.server";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";

// equipment.server.ts sends through a dynamic import of this module: `sendEmail(to, subject, element)`.
// Stubbing it keeps the suite offline and lets us assert on exactly what the Coordinator is sent.
const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn<(to: string, subject: string, element: ReactElement) => Promise<void>>(),
}));
vi.mock("#/lib/mailer.server", () => ({ sendEmail }));

type Database = ReturnType<typeof drizzle<typeof schema>>;

// Ids are namespaced `ptr43-` so this file's cleanup never touches another file's rows when the
// integration files share one database.
const fixtureUsers = {
  tech1: {
    id: "ptr43-tech-1",
    name: "PTR43 Tech One",
    email: "ptr43-tech1@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
  tech2: {
    id: "ptr43-tech-2",
    name: "PTR43 Tech Two",
    email: "ptr43-tech2@example.com",
    emailVerified: true,
    role: "technical_support_staff",
  },
  coordinator: {
    id: "ptr43-coord-1",
    name: "PTR43 Coordinator One",
    email: "ptr43-coord1@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  coordinator2: {
    id: "ptr43-coord-2",
    name: "PTR43 Coordinator Two",
    email: "ptr43-coord2@example.com",
    emailVerified: true,
    role: "event_coordinator",
  },
  organiser: {
    id: "ptr43-org-1",
    name: "PTR43 Organiser One",
    email: "ptr43-org1@example.com",
    emailVerified: true,
    role: "event_organiser",
  },
};

const session = (userKey: keyof typeof fixtureUsers): SessionUser => fixtureUsers[userKey];

type LineState = "requested" | "reserved" | "not_required" | "unavailable";
interface LineSeed {
  item?: string;
  quantity?: number;
  state: LineState;
  /** undefined -> unassigned. */
  assignedStaffId?: string;
  unavailableReason?: string;
}

describe("Equipment arrangement completion Integration (PTR-43)", () => {
  let pool: Pool;
  let database: Database;
  let testEquipmentTypeId: number;
  let fixtureVenueId: number;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });

    await cleanup();

    await Promise.all(
      Object.values(fixtureUsers).map(u =>
        database.insert(schema.user).values(u).onConflictDoNothing()
      )
    );

    const [venue] = await database
      .insert(schema.venues)
      .values({
        name: `PTR43 Test Hall ${Date.now()}`,
        location: "Building G",
        maxCapacity: 200,
        operatingHours: DEFAULT_OPERATING_HOURS,
      })
      .returning({ id: schema.venues.id });
    fixtureVenueId = venue.id;

    // Plenty of stock: availability is not what these tests are about.
    const [type] = await database
      .insert(schema.equipmentTypes)
      .values({ name: `PTR43 Test Projector ${Date.now()}`, quantityHeld: 10 })
      .returning({ id: schema.equipmentTypes.id });
    testEquipmentTypeId = type.id;
  });

  afterAll(async () => {
    await cleanup();
    if (testEquipmentTypeId) {
      await database
        .delete(schema.equipmentTypes)
        .where(eq(schema.equipmentTypes.id, testEquipmentTypeId));
    }
    if (fixtureVenueId) {
      await database.delete(schema.venues).where(eq(schema.venues.id, fixtureVenueId));
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

  /**
   * An event with an approved venue booking and any number of lines. Lines are assigned to nobody
   * unless told otherwise; `equipmentSubmitted: false` freezes the shared queue (and re-opens the
   * Coordinator's editing, which only works before submission). Use a distinct `day` when a test
   * creates two events, since the venue cannot be double-booked.
   */
  async function createEvent(params: {
    name: string;
    lines: LineSeed[];
    day?: string;
    status?: "approved" | "planning";
    equipmentSubmitted?: boolean;
  }) {
    const day = params.day ?? "2027-02-01";
    const startsAt = `${day} 10:00:00`;
    const endsAt = `${day} 14:00:00`;

    const [event] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: fixtureUsers.organiser.id,
        eventName: params.name,
        purpose: "PTR-43 Testing",
        status: params.status ?? "planning",
        assignedCoordinatorId: fixtureUsers.coordinator.id,
        assignedAt: new Date(),
        decidedByCoordinatorId: fixtureUsers.coordinator.id,
        decidedByCoordinatorName: fixtureUsers.coordinator.name,
        decidedAt: new Date(),
        submittedAt: new Date(),
        equipmentSubmittedAt: params.equipmentSubmitted === false ? null : new Date(),
        proposedDates: [{ start: `${day}T10:00`, end: `${day}T14:00` }],
      })
      .returning();

    await database.insert(schema.venueRequests).values({
      id: `vr-${crypto.randomUUID()}`,
      eventId: event.id,
      venueId: fixtureVenueId,
      requestedById: fixtureUsers.coordinator.id,
      assignedStaffId: fixtureUsers.coordinator.id,
      startsAt,
      endsAt,
      status: "approved",
    });

    const lineIds: string[] = [];

    const equipmentRows = params.lines.map((line, index) => {
      const id = `er-${crypto.randomUUID()}`;
      lineIds.push(id);

      return {
        id,
        eventId: event.id,
        equipmentTypeId: testEquipmentTypeId,
        item: line.item ?? `PTR43 Item ${index + 1}`,
        quantity: line.quantity ?? 2,
        arrangementStatus: line.state,
        assignedStaffId: line.assignedStaffId ?? null,
        unavailableReason: line.unavailableReason ?? null,
      };
    });

    if (equipmentRows.length > 0) {
      await database.insert(schema.equipmentRequests).values(equipmentRows);
    }

    return { eventId: event.id, lineIds };
  }

  const readEvent = async (eventId: number) =>
    (
      await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, eventId))
    )[0];
  const readLine = async (lineId: string) =>
    (
      await database
        .select()
        .from(schema.equipmentRequests)
        .where(eq(schema.equipmentRequests.id, lineId))
    )[0];
  const readLines = (eventId: number) =>
    database
      .select()
      .from(schema.equipmentRequests)
      .where(eq(schema.equipmentRequests.eventId, eventId));

  async function stampCompletion(eventId: number, by: string = fixtureUsers.tech1.id) {
    await database
      .update(schema.eventRequests)
      .set({
        equipmentArrangementsCompletedAt: new Date(),
        equipmentArrangementsCompletedById: by,
      })
      .where(eq(schema.eventRequests.id, eventId));
  }
  async function expectCompletionCleared(eventId: number) {
    const event = await readEvent(eventId);
    expect(event.equipmentArrangementsCompletedAt).toBeNull();
    expect(event.equipmentArrangementsCompletedById).toBeNull();
  }
  async function expectCompletionKept(eventId: number) {
    expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeInstanceOf(Date);
  }

  const sent = () =>
    sendEmail.mock.calls.map(([to, subject, element]) => ({
      to,
      subject,
      props: (element as ReactElement<Record<string, unknown>>).props,
    }));

  beforeEach(async () => {
    vi.resetAllMocks();
    sendEmail.mockResolvedValue(undefined);
    await cleanup();
  });

  // ── AC1 ───────────────────────────────────────────────────────────────────────────────────
  describe("AC1: mark arrangements complete", () => {
    it("records the completion time and actor when every line is reserved or not required", async () => {
      const { eventId } = await createEvent({
        name: "AC1 Complete",
        lines: [
          { state: "reserved", assignedStaffId: fixtureUsers.tech1.id },
          { state: "not_required", assignedStaffId: fixtureUsers.tech1.id },
        ],
      });

      const result = await handleCompleteArrangements(
        { eventId },
        session("tech1"),
        database as never
      );

      expect(result.id).toBe(eventId);
      const event = await readEvent(eventId);
      expect(event.equipmentArrangementsCompletedAt).toBeInstanceOf(Date);
      expect(event.equipmentArrangementsCompletedById).toBe(fixtureUsers.tech1.id);
    });

    it.each(["requested", "unavailable"] as const)(
      "refuses with 409 naming the blocking line, and records nothing, when a line is %s",
      async blocking => {
        const { eventId } = await createEvent({
          name: `AC1 Refused ${blocking}`,
          lines: [
            {
              item: "Fine Mic",
              state: "reserved",
              assignedStaffId: fixtureUsers.tech1.id,
            },
            {
              item: "Blocking Projector",
              state: blocking,
              assignedStaffId: fixtureUsers.tech1.id,
              unavailableReason: blocking === "unavailable" ? "Broken" : undefined,
            },
          ],
        });

        const attempt = handleCompleteArrangements(
          { eventId },
          session("tech1"),
          database as never
        );
        await expect(attempt).rejects.toMatchObject({
          name: "ConflictError",
          status: 409,
        });
        await expect(attempt).rejects.toThrow(/Blocking Projector/);
        await expect(attempt).rejects.not.toThrow(/Fine Mic/);

        await expectCompletionCleared(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
        expect(sendEmail).not.toHaveBeenCalled();
      }
    );

    it("names every blocking line in the refusal", async () => {
      const { eventId } = await createEvent({
        name: "AC1 Several Blockers",
        lines: [
          {
            item: "Projector",
            state: "requested",
            assignedStaffId: fixtureUsers.tech1.id,
          },
          {
            item: "Laptop",
            state: "unavailable",
            assignedStaffId: fixtureUsers.tech1.id,
            unavailableReason: "Broken",
          },
        ],
      });

      const attempt = handleCompleteArrangements({ eventId }, session("tech1"), database as never);
      await expect(attempt).rejects.toThrow(/Projector/);
      await expect(attempt).rejects.toThrow(/Laptop/);
    });

    it("refuses a Technical Support member who has no workable line on the event", async () => {
      const { eventId } = await createEvent({
        name: "AC1 No Access",
        lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
      });

      await expect(
        handleCompleteArrangements({ eventId }, session("tech2"), database as never)
      ).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
      await expectCompletionCleared(eventId);
      expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
    });

    it("lets a member complete when one line is theirs even though a colleague owns another", async () => {
      const { eventId } = await createEvent({
        name: "AC1 Shared Event",
        lines: [
          { state: "reserved", assignedStaffId: fixtureUsers.tech1.id },
          { state: "not_required", assignedStaffId: fixtureUsers.tech2.id },
        ],
      });

      await handleCompleteArrangements({ eventId }, session("tech2"), database as never);

      expect((await readEvent(eventId)).equipmentArrangementsCompletedById).toBe(
        fixtureUsers.tech2.id
      );
    });

    // Role gating is the requireEquipmentArrange middleware's job; the handler only checks line
    // ownership. These users own no line, so the handler refuses them regardless of role.
    it.each(["organiser", "coordinator"] as const)(
      "refuses a %s who owns none of the lines",
      async who => {
        const { eventId } = await createEvent({
          name: `AC1 Wrong Role ${who}`,
          lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await expect(
          handleCompleteArrangements({ eventId }, session(who), database as never)
        ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });
      }
    );

    it("refuses an unknown event as Forbidden, leaking nothing about whether it exists", async () => {
      await expect(
        handleCompleteArrangements({ eventId: 2_147_000_000 }, session("tech1"), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });
    });

    it("refuses an event with no lines (Forbidden today: the work-queue gate answers first)", async () => {
      const { eventId } = await createEvent({
        name: "AC1 No Lines",
        lines: [],
      });
      await expect(
        handleCompleteArrangements({ eventId }, session("tech1"), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });
      await expectCompletionCleared(eventId);
      expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
    });

    it("never leaves a completion over an unarranged line when completing races a revert", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC1 Race",
        lines: [{ state: "not_required", assignedStaffId: fixtureUsers.tech1.id }],
      });

      await Promise.allSettled([
        handleCompleteArrangements({ eventId }, session("tech1"), database as never),
        handleUpdateArrangement(
          { eventId, id: lineIds[0], arrangementStatus: "requested" },
          session("tech1"),
          database as never
        ),
      ]);

      const event = await readEvent(eventId);
      const lines = await readLines(eventId);
      expect(
        event.equipmentArrangementsCompletedAt === null ||
          lines.every(l => ["reserved", "not_required"].includes(l.arrangementStatus))
      ).toBe(true);
    });
  });

  // ── AC2 ───────────────────────────────────────────────────────────────────────────────────
  describe("AC2: record equipment unavailable", () => {
    it("sets the line unavailable, stores the trimmed reason and claims an unassigned line", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC2 Record",
        lines: [{ state: "requested" }],
      });

      const line = await handleRecordUnavailable(
        {
          eventId,
          id: lineIds[0],
          reason: "  Out for repair until November  ",
        },
        session("tech2"),
        database as never
      );

      expect(line.arrangementStatus).toBe("unavailable");
      const stored = await readLine(lineIds[0]);
      expect(stored.arrangementStatus).toBe("unavailable");
      expect(stored.unavailableReason).toBe("Out for repair until November");
      expect(stored.assignedStaffId).toBe(fixtureUsers.tech2.id);
    });

    it("replaces the reason when an unavailable line is recorded again", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC2 Re-record",
        lines: [{ state: "requested", assignedStaffId: fixtureUsers.tech1.id }],
      });
      await handleRecordUnavailable(
        { eventId, id: lineIds[0], reason: "First" },
        session("tech1"),
        database as never
      );

      await handleRecordUnavailable(
        { eventId, id: lineIds[0], reason: "Second" },
        session("tech1"),
        database as never
      );
      expect((await readLine(lineIds[0])).unavailableReason).toBe("Second");
    });

    it.each(["", "   "])("refuses a blank reason (%j) before touching the line", async reason => {
      const { eventId, lineIds } = await createEvent({
        name: "AC2 Blank Reason",
        lines: [{ state: "requested", assignedStaffId: fixtureUsers.tech1.id }],
      });
      await expect(
        handleRecordUnavailable(
          { eventId, id: lineIds[0], reason },
          session("tech1"),
          database as never
        )
      ).rejects.toThrow("Give a reason for marking this equipment unavailable");
      expect((await readLine(lineIds[0])).arrangementStatus).toBe("requested");
    });

    it("refuses a colleague's line even though another line keeps the event workable", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC2 Colleague",
        lines: [
          {
            item: "Mic",
            state: "requested",
            assignedStaffId: fixtureUsers.tech1.id,
          },
          { item: "Cables", state: "requested" },
        ],
      });

      await expect(
        handleRecordUnavailable(
          { eventId, id: lineIds[0], reason: "No stock" },
          session("tech2"),
          database as never
        )
      ).rejects.toMatchObject({
        name: "AuthorizationError",
        status: 403,
        message: "Forbidden",
      });
      expect((await readLine(lineIds[0])).arrangementStatus).toBe("requested");
    });

    it("refuses a line that belongs to a different event", async () => {
      const a = await createEvent({
        name: "AC2 Event A",
        day: "2027-02-01",
        lines: [{ state: "requested", assignedStaffId: fixtureUsers.tech1.id }],
      });
      const b = await createEvent({
        name: "AC2 Event B",
        day: "2027-02-02",
        lines: [{ state: "requested", assignedStaffId: fixtureUsers.tech1.id }],
      });

      await expect(
        handleRecordUnavailable(
          { eventId: a.eventId, id: b.lineIds[0], reason: "No stock" },
          session("tech1"),
          database as never
        )
      ).rejects.toMatchObject({ name: "NotFoundError" });
      expect((await readLine(b.lineIds[0])).arrangementStatus).toBe("requested");
    });

    it("refuses a reserved line and leaves it reserved", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC2 Reserved",
        lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
      });

      await expect(
        handleRecordUnavailable(
          { eventId, id: lineIds[0], reason: "Recalled" },
          session("tech1"),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: ARRANGEMENT_RESERVED_MESSAGE,
      });
      expect((await readLine(lineIds[0])).arrangementStatus).toBe("reserved");
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("refuses a partially reserved line (still requested, but holding a reservation row)", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC2 Partial",
        lines: [
          {
            state: "requested",
            quantity: 4,
            assignedStaffId: fixtureUsers.tech1.id,
          },
        ],
      });
      await handleReserveEquipment(
        { equipmentRequestId: lineIds[0], quantity: 2 },
        session("tech1"),
        database as never
      );
      expect((await readLine(lineIds[0])).arrangementStatus).toBe("requested");

      await expect(
        handleRecordUnavailable(
          { eventId, id: lineIds[0], reason: "Cannot supply the rest" },
          session("tech1"),
          database as never
        )
      ).rejects.toMatchObject({
        name: "ConflictError",
        status: 409,
        message: ARRANGEMENT_RESERVED_MESSAGE,
      });
    });

    it("clears an existing completion when a not-required line is marked unavailable", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC2 Clears Completion",
        lines: [
          { state: "not_required", assignedStaffId: fixtureUsers.tech1.id },
          { state: "reserved", assignedStaffId: fixtureUsers.tech1.id },
        ],
      });
      await stampCompletion(eventId);

      await handleRecordUnavailable(
        { eventId, id: lineIds[0], reason: "Recalled" },
        session("tech1"),
        database as never
      );

      await expectCompletionCleared(eventId);
      expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
    });
  });

  // ── AC3 ───────────────────────────────────────────────────────────────────────────────────
  describe("AC3: the assigned Coordinator is notified", () => {
    it("completion: emails only the assigned Coordinator, with the line count", async () => {
      const { eventId } = await createEvent({
        name: "AC3 Complete Mail",
        lines: [
          { state: "reserved", assignedStaffId: fixtureUsers.tech1.id },
          { state: "not_required", assignedStaffId: fixtureUsers.tech1.id },
        ],
      });

      await handleCompleteArrangements({ eventId }, session("tech1"), database as never);

      expect(sent()).toEqual([
        {
          to: fixtureUsers.coordinator.email,
          subject: `Equipment arrangements complete for event ${eventId}`,
          props: { eventId, lineCount: 2 },
        },
      ]);
    });

    it("unavailable: emails the assigned Coordinator the item, quantity and reason", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC3 Unavailable Mail",
        lines: [
          {
            item: "Wireless microphone",
            quantity: 3,
            state: "requested",
            assignedStaffId: fixtureUsers.tech1.id,
          },
        ],
      });

      await handleRecordUnavailable(
        { eventId, id: lineIds[0], reason: "Out for repair" },
        session("tech1"),
        database as never
      );

      expect(sent()).toEqual([
        {
          to: fixtureUsers.coordinator.email,
          subject: `Equipment unavailable for event ${eventId}`,
          props: {
            eventId,
            item: "Wireless microphone",
            quantity: 3,
            reason: "Out for repair",
          },
        },
      ]);
    });

    it("does not email another Coordinator", async () => {
      const { eventId } = await createEvent({
        name: "AC3 Only Assigned",
        lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
      });
      await handleCompleteArrangements({ eventId }, session("tech1"), database as never);
      expect(sent().some(m => m.to === fixtureUsers.coordinator2.email)).toBe(false);
    });

    it("sends nothing when the action is refused", async () => {
      const { eventId } = await createEvent({
        name: "AC3 Refused",
        lines: [{ state: "requested", assignedStaffId: fixtureUsers.tech1.id }],
      });
      await expect(
        handleCompleteArrangements({ eventId }, session("tech1"), database as never)
      ).rejects.toMatchObject({ status: 409 });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("keeps the completion when the mail fails", async () => {
      sendEmail.mockRejectedValue(new Error("SMTP down"));
      const { eventId } = await createEvent({
        name: "AC3 Mail Down Complete",
        lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
      });

      await expect(
        handleCompleteArrangements({ eventId }, session("tech1"), database as never)
      ).resolves.toMatchObject({ id: eventId });
      await expectCompletionKept(eventId);
    });

    it("keeps the unavailable record when the mail fails", async () => {
      sendEmail.mockRejectedValue(new Error("SMTP down"));
      const { eventId, lineIds } = await createEvent({
        name: "AC3 Mail Down Unavailable",
        lines: [{ state: "requested", assignedStaffId: fixtureUsers.tech1.id }],
      });

      await handleRecordUnavailable(
        { eventId, id: lineIds[0], reason: "No stock" },
        session("tech1"),
        database as never
      );
      expect((await readLine(lineIds[0])).arrangementStatus).toBe("unavailable");
    });

    it("does not fail and sends nothing when the event has no assigned Coordinator", async () => {
      const { eventId } = await createEvent({
        name: "AC3 No Coordinator",
        lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
      });
      // If your schema forbids this on a planning event, drop this test: the handler just logs.
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: null })
        .where(eq(schema.eventRequests.id, eventId));

      await expect(
        handleCompleteArrangements({ eventId }, session("tech1"), database as never)
      ).resolves.toMatchObject({ id: eventId });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("sends only after the commit: the stamp is already readable when the mailer runs", async () => {
      const { eventId } = await createEvent({
        name: "AC3 After Commit",
        lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
      });
      let seenAtSend: Date | null = null;
      sendEmail.mockImplementation(async () => {
        seenAtSend = (await readEvent(eventId)).equipmentArrangementsCompletedAt;
      });

      await handleCompleteArrangements({ eventId }, session("tech1"), database as never);

      expect(seenAtSend).toBeInstanceOf(Date);
    });
  });

  // ── AC4 ───────────────────────────────────────────────────────────────────────────────────
  describe("AC4: the completion is read only while every line is reserved or not required", () => {
    describe("what the event view shows", () => {
      it("shows the completion to the Coordinator and Technical Support, not to the Organiser", async () => {
        const { eventId } = await createEvent({
          name: "AC4 Roles",
          lines: [{ state: "not_required", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await handleCompleteArrangements({ eventId }, session("tech1"), database as never);
        const stamp = (await readEvent(eventId)).equipmentArrangementsCompletedAt?.toISOString();

        const [forCoordinator] = await handleListEvents(
          { eventId },
          session("coordinator"),
          database as never
        );
        const [forTech] = await handleListEvents({ eventId }, session("tech1"), database as never);
        const [forOrganiser] = await handleListEvents(
          { eventId },
          session("organiser"),
          database as never
        );

        expect(forCoordinator.event.equipmentArrangementsCompletedAt).toBe(stamp);
        expect(forTech.event.equipmentArrangementsCompletedAt).toBe(stamp);
        expect(forOrganiser.event).not.toHaveProperty("equipmentArrangementsCompletedAt");
      });

      it("hides a stale stamp when a line has left reserved / not required behind the handlers' back", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Stale Stamp",
          lines: [{ state: "not_required", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await stampCompletion(eventId);
        await database
          .update(schema.equipmentRequests)
          .set({ arrangementStatus: "requested" })
          .where(eq(schema.equipmentRequests.id, lineIds[0]));

        const [forCoordinator] = await handleListEvents(
          { eventId },
          session("coordinator"),
          database as never
        );
        const [forTech] = await handleListEvents({ eventId }, session("tech1"), database as never);

        expect(forCoordinator.event.equipmentArrangementsCompletedAt).toBeNull();
        expect(forTech.event.equipmentArrangementsCompletedAt).toBeNull();
      });
    });

    describe("clearing driven by Technical Support", () => {
      it("clears when a not-required line goes back to requested", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Revert",
          lines: [{ state: "not_required", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await stampCompletion(eventId);

        await handleUpdateArrangement(
          { eventId, id: lineIds[0], arrangementStatus: "requested" },
          session("tech1"),
          database as never
        );

        await expectCompletionCleared(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
      });

      it("keeps the completion for a notes-only annotation", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Notes Only",
          lines: [{ state: "not_required", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await stampCompletion(eventId);

        await handleUpdateArrangement(
          { eventId, id: lineIds[0], arrangementNotes: "Checked on site" },
          session("tech1"),
          database as never
        );

        await expectCompletionKept(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeInstanceOf(Date);
      });

      it("is not restored when the line is re-arranged: Technical Support must complete again", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Not Restored",
          lines: [{ state: "not_required", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await stampCompletion(eventId);

        await handleUpdateArrangement(
          { eventId, id: lineIds[0], arrangementStatus: "requested" },
          session("tech1"),
          database as never
        );

        await handleUpdateArrangement(
          { eventId, id: lineIds[0], arrangementStatus: "not_required" },
          session("tech1"),
          database as never
        );
        await expectCompletionCleared(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();

        await handleCompleteArrangements({ eventId }, session("tech1"), database as never);
        await expectCompletionKept(eventId);
      });

      it("a reserved line cannot be moved by an update, so the attempt leaves the completion alone", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Reserved Frozen",
          lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await stampCompletion(eventId);

        await expect(
          handleUpdateArrangement(
            { eventId, id: lineIds[0], arrangementStatus: "requested" },
            session("tech1"),
            database as never
          )
        ).rejects.toMatchObject({
          name: "ConflictError",
          message: ARRANGEMENT_RESERVED_MESSAGE,
        });
        await expectCompletionKept(eventId);
      });

      it("clears when a reservation is reduced below the requested quantity", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Reduce",
          lines: [
            {
              state: "requested",
              quantity: 4,
              assignedStaffId: fixtureUsers.tech1.id,
            },
          ],
        });
        await handleReserveEquipment(
          { equipmentRequestId: lineIds[0], quantity: 4 },
          session("tech1"),
          database as never
        );
        expect((await readLine(lineIds[0])).arrangementStatus).toBe("reserved");
        await stampCompletion(eventId);

        await handleReserveEquipment(
          { equipmentRequestId: lineIds[0], quantity: 2 },
          session("tech1"),
          database as never
        );

        expect((await readLine(lineIds[0])).arrangementStatus).toBe("requested");
        await expectCompletionCleared(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
      });

      it("keeps the completion when the same full quantity is re-reserved", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Re-reserve Same",
          lines: [
            {
              state: "requested",
              quantity: 4,
              assignedStaffId: fixtureUsers.tech1.id,
            },
          ],
        });
        await handleReserveEquipment(
          { equipmentRequestId: lineIds[0], quantity: 4 },
          session("tech1"),
          database as never
        );
        await stampCompletion(eventId);

        await handleReserveEquipment(
          { equipmentRequestId: lineIds[0], quantity: 4 },
          session("tech1"),
          database as never
        );

        await expectCompletionKept(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeInstanceOf(Date);
      });

      it("releases the reservation, returns the line to requested, and clears completion", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Release",
          lines: [
            {
              state: "reserved",
              quantity: 2,
              assignedStaffId: fixtureUsers.tech1.id,
            },
          ],
        });
        await database.insert(schema.equipmentReservations).values({
          id: `eq-res-${crypto.randomUUID()}`,
          equipmentRequestId: lineIds[0],
          equipmentTypeId: testEquipmentTypeId,
          quantity: 2,
          startsAt: "2027-02-01 10:00:00",
          endsAt: "2027-02-01 14:00:00",
        });
        await stampCompletion(eventId);

        await handleReleaseEquipmentReservation(
          { equipmentRequestId: lineIds[0] },
          session("tech1"),
          database as never
        );

        expect((await readLine(lineIds[0])).arrangementStatus).toBe("requested");
        expect(
          await database
            .select()
            .from(schema.equipmentReservations)
            .where(eq(schema.equipmentReservations.equipmentRequestId, lineIds[0]))
        ).toHaveLength(0);
        await expectCompletionCleared(eventId);
        expect((await readEvent(eventId)).status).toBe("planning");
      });
    });

    describe("clearing driven by the Coordinator (defence in depth: only before submission)", () => {
      it("clears when a line is added", async () => {
        const { eventId } = await createEvent({
          name: "AC4 Add",
          equipmentSubmitted: false,
          lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await stampCompletion(eventId);

        await handleSaveEquipmentLine(
          { eventId, item: "Laptop", quantity: 1 },
          session("coordinator"),
          database as never
        );

        await expectCompletionCleared(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
      });

      it("clears when a line is edited", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Edit",
          equipmentSubmitted: false,
          lines: [
            {
              item: "Cables",
              quantity: 2,
              state: "not_required",
              assignedStaffId: fixtureUsers.tech1.id,
            },
          ],
        });
        await stampCompletion(eventId);

        await handleSaveEquipmentLine(
          { eventId, id: lineIds[0], item: "Cables", quantity: 3 },
          session("coordinator"),
          database as never
        );

        await expectCompletionCleared(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
      });

      it("clears when a line is removed, even if the remaining lines are all arranged", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Remove",
          equipmentSubmitted: false,
          lines: [
            { state: "reserved", assignedStaffId: fixtureUsers.tech1.id },
            { state: "not_required", assignedStaffId: fixtureUsers.tech1.id },
          ],
        });
        await stampCompletion(eventId);

        await handleRemoveEquipmentLine(
          { eventId, id: lineIds[1] },
          session("coordinator"),
          database as never
        );

        await expectCompletionCleared(eventId);
        expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
      });

      it("after submission add, edit and remove are all refused, so the completion stands", async () => {
        const { eventId, lineIds } = await createEvent({
          name: "AC4 Frozen After Submit",
          lines: [{ state: "not_required", assignedStaffId: fixtureUsers.tech1.id }],
        });
        await stampCompletion(eventId);

        await expect(
          handleSaveEquipmentLine(
            { eventId, item: "Laptop", quantity: 1 },
            session("coordinator"),
            database as never
          )
        ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
        await expect(
          handleSaveEquipmentLine(
            { eventId, id: lineIds[0], item: "Cables", quantity: 9 },
            session("coordinator"),
            database as never
          )
        ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
        await expect(
          handleRemoveEquipmentLine(
            { eventId, id: lineIds[0] },
            session("coordinator"),
            database as never
          )
        ).rejects.toMatchObject({ name: "ConflictError", status: 409 });

        await expectCompletionKept(eventId);
        expect(await readLines(eventId)).toHaveLength(1);
      });
    });
  });

  // ── AC5 ───────────────────────────────────────────────────────────────────────────────────
  describe("PTR-24: confirm equipment arrangements", () => {
    it("confirms when there are no equipment lines", async () => {
      const { eventId } = await createEvent({ name: "Confirm Without Equipment", lines: [] });

      const confirmed = await handleConfirmEventRequest(
        { id: eventId },
        session("coordinator"),
        database as never
      );

      expect(confirmed.status).toBe("confirmed");
      expect((await readEvent(eventId)).status).toBe("confirmed");
    });

    it("refuses confirmation until all lines are arranged and completion is recorded", async () => {
      const { eventId } = await createEvent({
        name: "Confirm Requires Completion",
        lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
      });

      await expect(
        handleConfirmEventRequest({ id: eventId }, session("coordinator"), database as never)
      ).rejects.toThrow("Technical arrangements must be marked complete");

      await stampCompletion(eventId);
      const [line] = await readLines(eventId);
      await database
        .update(schema.equipmentRequests)
        .set({ arrangementStatus: "requested" })
        .where(eq(schema.equipmentRequests.id, line.id));

      await expect(
        handleConfirmEventRequest({ id: eventId }, session("coordinator"), database as never)
      ).rejects.toThrow(/Equipment arrangements are not ready.*PTR43 Item 1/);
      expect((await readEvent(eventId)).status).toBe("planning");
    });

    it("confirms arranged and completed lines without changing other event fields", async () => {
      const { eventId } = await createEvent({
        name: "Confirm With Equipment",
        lines: [
          { state: "reserved", assignedStaffId: fixtureUsers.tech1.id },
          { state: "not_required", assignedStaffId: fixtureUsers.tech1.id },
        ],
      });
      await stampCompletion(eventId);

      const confirmed = await handleConfirmEventRequest(
        { id: eventId },
        session("coordinator"),
        database as never
      );

      expect(confirmed.status).toBe("confirmed");
      expect(confirmed.equipmentArrangementsCompletedAt).toBeInstanceOf(Date);
    });

    it("refuses confirmation by anyone other than the assigned Coordinator", async () => {
      const { eventId } = await createEvent({
        name: "Confirm Wrong Coordinator",
        lines: [],
      });

      await expect(
        handleConfirmEventRequest({ id: eventId }, session("coordinator2"), database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });
    });
  });

  // ── AC5 ───────────────────────────────────────────────────────────────────────────────────
  describe("AC5: the event status is unchanged", () => {
    it.each(["approved", "planning"] as const)(
      "completing leaves a %s event as it was",
      async status => {
        const { eventId } = await createEvent({
          name: `AC5 Complete ${status}`,
          status,
          lines: [{ state: "reserved", assignedStaffId: fixtureUsers.tech1.id }],
        });

        await handleCompleteArrangements({ eventId }, session("tech1"), database as never);

        expect((await readEvent(eventId)).status).toBe(status);
      }
    );

    it("recording unavailable leaves the status as it was", async () => {
      const { eventId, lineIds } = await createEvent({
        name: "AC5 Unavailable",
        lines: [{ state: "requested", assignedStaffId: fixtureUsers.tech1.id }],
      });

      await handleRecordUnavailable(
        { eventId, id: lineIds[0], reason: "No stock" },
        session("tech1"),
        database as never
      );

      expect((await readEvent(eventId)).status).toBe("planning");
    });
  });

  // ── AC6 ───────────────────────────────────────────────────────────────────────────────────
  describe("AC6: no equipment requirements", () => {
    it("shows the Coordinator an empty equipment list and no completion", async () => {
      const { eventId } = await createEvent({
        name: "AC6 No Lines",
        lines: [],
      });

      const [projection] = await handleListEvents(
        { eventId },
        session("coordinator"),
        database as never
      );

      expect(projection.event.equipment).toEqual([]);
      expect(projection.event.equipmentArrangementsCompletedAt).toBeNull();
    });

    it("records no completion for an event without lines", async () => {
      const { eventId } = await createEvent({
        name: "AC6 No Completion",
        lines: [],
      });

      await expect(
        handleCompleteArrangements({ eventId }, session("tech1"), database as never)
      ).rejects.toThrow("Forbidden");

      await expectCompletionCleared(eventId);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  // ── Migration 0029 ────────────────────────────────────────────────────────────────────────
  describe("migration 0029", () => {
    it("new events start with no completion recorded", async () => {
      const { eventId } = await createEvent({
        name: "Migration Defaults",
        lines: [],
      });
      await expectCompletionCleared(eventId);
      expect((await readEvent(eventId)).equipmentArrangementsCompletedAt).toBeNull();
    });

    it("keeps the timestamp and nulls the actor when the completing user is deleted", async () => {
      const leaver = {
        id: "ptr43-leaver",
        name: "PTR43 Leaver",
        email: "ptr43-leaver@example.com",
        emailVerified: true,
        role: "technical_support_staff",
      };
      await database.insert(schema.user).values(leaver).onConflictDoNothing();
      const { eventId } = await createEvent({
        name: "Migration FK",
        lines: [],
      });
      await stampCompletion(eventId, leaver.id);

      await database.delete(schema.user).where(eq(schema.user.id, leaver.id));

      const event = await readEvent(eventId);
      expect(event.equipmentArrangementsCompletedById).toBeNull();
      expect(event.equipmentArrangementsCompletedAt).toBeInstanceOf(Date);
    });

    it("refuses a completed_by_id that is not a user", async () => {
      const { eventId } = await createEvent({
        name: "Migration Bad FK",
        lines: [],
      });

      await expect(
        database
          .update(schema.eventRequests)
          .set({ equipmentArrangementsCompletedById: "ptr43-nobody" })
          .where(eq(schema.eventRequests.id, eventId))
      ).rejects.toThrow("Failed query");
    });
  });
});
