// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { runSeed } from "../../scripts/seed";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import {
  handleGetCoordinationRequest,
  handleListAssignedEventRequests,
} from "#/features/coordination/assignments.server";
import { handleReserveEquipment } from "#/features/equipment-requests/reservations.server";
import { handleRequestEventCancellation } from "#/features/event-requests/cancellation-requests.server";
import { handleRaiseEventChangeRequest } from "#/features/event-requests/change-requests.server";
import { EVENT_HAS_NOT_ENDED_MESSAGE } from "#/features/events/completion";
import { handleCompleteEvent } from "#/features/events/complete.server";
import { handleListEvents } from "#/features/events/records.server";
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
    expect(saved.actualAttendance).toBeNull();
  });

  test("records the given actual attendance on completion (PTR-157 AC1)", async () => {
    const event = await createConfirmedEvent();

    await handleCompleteEvent(
      { id: event.id, actualAttendance: 42 },
      coordinator,
      database as never
    );

    const [saved] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, event.id));
    expect(saved.status).toBe("completed");
    expect(saved.actualAttendance).toBe(42);
  });

  test("records a zero turnout on completion (PTR-157 AC1)", async () => {
    const event = await createConfirmedEvent();

    await handleCompleteEvent(
      { id: event.id, actualAttendance: 0 },
      coordinator,
      database as never
    );

    const [saved] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, event.id));
    expect(saved.actualAttendance).toBe(0);
  });

  test("refuses a negative turnout before any write (PTR-157 AC1)", async () => {
    const event = await createConfirmedEvent();

    await expect(
      handleCompleteEvent({ id: event.id, actualAttendance: -1 }, coordinator, database as never)
    ).rejects.toThrow("Actual attendance must be a whole number of zero or more");

    const [saved] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, event.id));
    expect(saved.status).toBe("confirmed");
    expect(saved.actualAttendance).toBeNull();
  });

  test("completes a past event end even when its approved booking is in the future", async () => {
    const event = await createConfirmedEvent();
    await database
      .update(schema.venueRequests)
      .set({ startsAt: "2100-03-10 09:00:00", endsAt: "2100-03-10 12:30:00" })
      .where(eq(schema.venueRequests.eventId, event.id));

    await expect(complete(event.id)).resolves.toMatchObject({ status: "completed" });
  });

  test("refuses a future event end even when its approved booking has ended", async () => {
    const event = await createConfirmedEvent("2100-03-10 12:30:00");
    await database
      .update(schema.venueRequests)
      .set({
        startsAt: sql`timezone('Asia/Singapore', now()) - interval '2 hours'`,
        endsAt: sql`timezone('Asia/Singapore', now()) - interval '1 minute'`,
      })
      .where(eq(schema.venueRequests.eventId, event.id));

    await expect(complete(event.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(EVENT_HAS_NOT_ENDED_MESSAGE),
    });
  });

  test("ignores a released booking when the event end has passed", async () => {
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

  test("reports the completion reason on the coordinator event list", async () => {
    const ended = await createConfirmedEvent();
    const upcoming = await createConfirmedEvent("2100-03-10 12:30:00");

    const [endedEntry] = await handleListEvents(
      { eventId: ended.id },
      coordinator,
      database as never
    );
    const [upcomingEntry] = await handleListEvents(
      { eventId: upcoming.id },
      coordinator,
      database as never
    );

    expect(endedEntry.event.completionUnavailableReason).toBeNull();
    expect(upcomingEntry.event.completionUnavailableReason).toBe(EVENT_HAS_NOT_ENDED_MESSAGE);
  });

  test("declines waiting change and cancellation requests with the Organiser told (PTR-156)", async () => {
    const event = await createConfirmedEvent();
    const change = await handleRaiseEventChangeRequest(
      { id: event.id, whatShouldChange: "Expected attendance", requestedValue: "120 attendees" },
      organiser,
      database as never
    );
    await handleRequestEventCancellation({ id: event.id }, organiser, database as never);

    await complete(event.id);

    const changes = await database
      .select()
      .from(schema.eventChangeRequests)
      .where(eq(schema.eventChangeRequests.eventRequestId, event.id));
    expect(changes).toEqual([
      expect.objectContaining({
        id: change.id,
        outcome: "declined",
        declineReason: "Event completed",
        processedById: coordinator.id,
        processedByName: coordinator.name,
      }),
    ]);
    expect(changes[0].processedAt).toBeInstanceOf(Date);
    const cancellations = await database
      .select()
      .from(schema.eventCancellationRequests)
      .where(eq(schema.eventCancellationRequests.eventRequestId, event.id));
    expect(cancellations).toEqual([
      expect.objectContaining({
        outcome: "declined",
        declineReason: "Event completed",
        processedById: coordinator.id,
        processedByName: coordinator.name,
      }),
    ]);

    // The Organiser gets the existing decline notice for each closed request.
    const noticesFor = (kind: "event_change_processed" | "event_cancellation_declined") =>
      database
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.eventRequestId, event.id),
            eq(schema.notifications.kind, kind)
          )
        );
    const changeNotices = await noticesFor("event_change_processed");
    expect(changeNotices).toHaveLength(1);
    expect(changeNotices[0]).toMatchObject({
      recipientId: organiser.id,
      payload: {
        outcome: "declined",
        eventName: event.eventName,
        whatShouldChange: "Expected attendance",
        reason: "Event completed",
      },
    });
    const cancellationNotices = await noticesFor("event_cancellation_declined");
    expect(cancellationNotices).toHaveLength(1);
    expect(cancellationNotices[0]).toMatchObject({
      recipientId: organiser.id,
      payload: {
        eventName: event.eventName,
        reason: "Event completed",
        closeOut: true,
        eventStatus: "completed",
      },
    });

    // A closed request no longer counts as waiting on the Coordinator's list or detail view.
    const assigned = await handleListAssignedEventRequests(coordinator, database as never);
    expect(assigned.find(row => row.id === event.id)?.changeRequestsWaiting).toBe(0);
    const view = await handleGetCoordinationRequest(
      { id: event.id },
      coordinator,
      database as never
    );
    expect(view.changeRequests.map(request => request.outcome)).toEqual(["declined"]);
    expect(view.cancellationRequests.map(request => request.outcome)).toEqual(["declined"]);
  });

  test("falls back to the email for the processor when the Coordinator name is blank (PTR-156)", async () => {
    const event = await createConfirmedEvent();
    await handleRaiseEventChangeRequest(
      { id: event.id, whatShouldChange: "Expected attendance", requestedValue: "120 attendees" },
      organiser,
      database as never
    );
    await handleRequestEventCancellation({ id: event.id }, organiser, database as never);

    await complete(event.id, { ...coordinator, name: "" });

    const [saved] = await database
      .select()
      .from(schema.eventRequests)
      .where(eq(schema.eventRequests.id, event.id));
    expect(saved.completedByName).toBe(coordinator.email);
    const [change] = await database
      .select()
      .from(schema.eventChangeRequests)
      .where(eq(schema.eventChangeRequests.eventRequestId, event.id));
    expect(change.processedByName).toBe(coordinator.email);
    const [cancellation] = await database
      .select()
      .from(schema.eventCancellationRequests)
      .where(eq(schema.eventCancellationRequests.eventRequestId, event.id));
    expect(cancellation.processedByName).toBe(coordinator.email);
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

  test("rejects a completed status without the completion audit record at the database", async () => {
    const event = await createConfirmedEvent();

    await expect(
      database
        .update(schema.eventRequests)
        .set({ status: "completed" })
        .where(eq(schema.eventRequests.id, event.id))
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "event_requests_completion_matches_status" },
    });
  });

  test("rejects completion audit fields on a non-terminal status at the database", async () => {
    const event = await createConfirmedEvent();

    await expect(
      database
        .update(schema.eventRequests)
        .set({
          completedById: coordinator.id,
          completedByName: coordinator.name,
          completedAt: new Date(),
        })
        .where(eq(schema.eventRequests.id, event.id))
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "event_requests_completion_matches_status" },
    });
  });

  test("rejects a negative actual attendance at the database (PTR-157)", async () => {
    const event = await createConfirmedEvent();

    await expect(
      database
        .update(schema.eventRequests)
        .set({ actualAttendance: -1 })
        .where(eq(schema.eventRequests.id, event.id))
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "event_requests_actual_attendance_nonnegative" },
    });
  });
});
