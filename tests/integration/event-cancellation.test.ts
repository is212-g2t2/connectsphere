// Mirrors event-confirmation.test.ts: a local node-postgres drizzle instance, not the app's
// `#/db`, with notifications read back from the `notifications` table.
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "#/db/schema";
import { AuthorizationError, ConflictError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { handleGetCoordinationRequest } from "#/features/coordination/assignments.server";
import { handleRequestEventCancellation } from "#/features/event-requests/cancellation-requests.server";
import {
  handleGetEventRequest,
  handleListUnassignedEventRequests,
} from "#/features/event-requests/drafts.server";
import {
  EVENT_CANCELLATION_ALREADY_REQUESTED,
  EVENT_CANCELLATION_CLOSED,
} from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import {
  notificationHref,
  notificationSummary,
  parseNotificationPayload,
} from "#/features/notifications/message";
import { renderNotificationEmail } from "#/features/notifications/render.server";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const actor = (id: string, role: string, name = id): SessionUser => ({
  id,
  role,
  name,
  email: `${id}@x.test`,
});

const organiser = actor("cancellation-organiser", "event_organiser", "Cancel Organiser");
const otherOrganiser = actor("cancellation-other-organiser", "event_organiser");
const coordinator = actor("cancellation-coordinator", "event_coordinator", "Cancel Coordinator");
const users = [organiser, otherOrganiser, coordinator];

const DECIDED = new Set<EventRequestStatus>(["approved", "rejected", "planning", "confirmed"]);

async function conflict(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConflictError);
  return (error as Error).message;
}

function parsed(notice: { kind: string; payload: unknown; eventRequestId: number }) {
  const result = parseNotificationPayload(notice.kind, notice.payload);
  if (!result) throw new Error(`${notice.kind} did not parse`);
  return { ...result, eventRequestId: notice.eventRequestId };
}

describe("requesting an event's cancellation (PTR-53)", () => {
  let pool: Pool;
  let database: Database;
  const created: number[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    database = drizzle(pool, { schema });

    await database
      .insert(schema.user)
      .values(
        users.map(user => ({
          id: user.id,
          name: user.name ?? user.id,
          email: user.email,
          emailVerified: true,
          role: user.role ?? undefined,
        }))
      )
      .onConflictDoNothing();
  });

  afterEach(async () => {
    if (created.length === 0) return;
    // Requests and notifications cascade with the event.
    await database.delete(schema.eventRequests).where(inArray(schema.eventRequests.id, created));
    created.length = 0;
  });

  afterAll(async () => {
    await database.delete(schema.user).where(
      inArray(
        schema.user.id,
        users.map(user => user.id)
      )
    );
    await pool.end();
  });

  async function createEvent(
    status: EventRequestStatus = "confirmed",
    { assigned = true }: { assigned?: boolean } = {}
  ) {
    const decided = DECIDED.has(status) || status === "completed";
    const confirmed = status === "confirmed" || status === "completed";
    const completed = status === "completed";
    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status,
        submittedAt: status === "draft" ? null : new Date(),
        ...(assigned && status !== "draft"
          ? { assignedCoordinatorId: coordinator.id, assignedAt: new Date() }
          : {}),
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
              confirmedAt: new Date(),
            }
          : {}),
        ...(completed
          ? {
              completedById: coordinator.id,
              completedByName: coordinator.name,
              completedAt: new Date(),
            }
          : {}),
        eventName: `Cancellation test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [{ start: "2026-12-05T10:00", end: "2026-12-05T16:00" }],
        expectedAttendance: 10,
        eventType: "Conference",
        ...(status === "confirmed"
          ? {
              registrationEnabled: true,
              registrationCapacity: 40,
              registrationOpensAt: "2026-01-01T09:00",
              registrationClosesAt: "2099-01-01T09:00",
            }
          : {}),
      })
      .returning();
    created.push(row.id);
    return row;
  }

  const requestCancellation = (eventId: number, as: SessionUser = organiser) =>
    handleRequestEventCancellation({ id: eventId }, as, database as never);

  const eventRow = async (id: number) =>
    (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0];

  const requestsFor = (eventId: number) =>
    database
      .select()
      .from(schema.eventCancellationRequests)
      .where(eq(schema.eventCancellationRequests.eventRequestId, eventId));

  const notificationsFor = (
    eventId: number,
    kind: (typeof schema.notificationKind.enumValues)[number]
  ) =>
    database
      .select()
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.eventRequestId, eventId), eq(schema.notifications.kind, kind))
      )
      .orderBy(schema.notifications.recipientId);

  // ─────────────────────────────────────────────────────────────────────────────────
  describe("requesting cancellation (PTR-53)", () => {
    test("records the Organiser's request on their event (AC1)", async () => {
      const event = await createEvent("planning");

      const request = await requestCancellation(event.id);

      expect(request).toMatchObject({
        eventRequestId: event.id,
        organiserId: organiser.id,
        outcome: null,
        processedAt: null,
      });
      const detail = await handleGetEventRequest({ id: event.id }, organiser, database as never);
      expect(detail?.cancellationRequests).toEqual([
        expect.objectContaining({ id: request.id, outcome: null }),
      ]);
    });

    test("refuses another Organiser's event and an unknown id the same way (AC1)", async () => {
      const event = await createEvent("planning");

      await expect(requestCancellation(event.id, otherOrganiser)).rejects.toBeInstanceOf(
        AuthorizationError
      );
      await expect(requestCancellation(2_000_000_000)).rejects.toBeInstanceOf(AuthorizationError);
      expect(await requestsFor(event.id)).toEqual([]);
    });

    test.each([
      "submitted",
      "under_review",
      "awaiting_organiser",
      "approved",
      "rejected",
      "planning",
      "confirmed",
    ] satisfies EventRequestStatus[])("accepts a %s event (AC2)", async status => {
      const event = await createEvent(status);

      await expect(requestCancellation(event.id)).resolves.toMatchObject({ outcome: null });
    });

    test("applies no deadline: an event that has already started is accepted (AC2)", async () => {
      const event = await createEvent("confirmed");
      await database
        .update(schema.eventRequests)
        .set({ proposedDates: [{ start: "2020-01-01T09:00", end: "2099-01-01T09:00" }] })
        .where(eq(schema.eventRequests.id, event.id));

      await expect(requestCancellation(event.id)).resolves.toMatchObject({ outcome: null });
    });

    test.each(["draft", "completed", "cancelled"] satisfies EventRequestStatus[])(
      "refuses a %s event (AC2)",
      async status => {
        const event = await createEvent(status);

        expect(await conflict(requestCancellation(event.id))).toBe(EVENT_CANCELLATION_CLOSED);
        expect(await requestsFor(event.id)).toEqual([]);
      }
    );

    test("refuses a second request while one waits", async () => {
      const event = await createEvent("planning");
      await requestCancellation(event.id);

      expect(await conflict(requestCancellation(event.id))).toBe(
        EVENT_CANCELLATION_ALREADY_REQUESTED
      );
      expect(await requestsFor(event.id)).toHaveLength(1);
    });

    test("records one request when the Organiser asks twice at once", async () => {
      const event = await createEvent("planning");

      const results = await Promise.allSettled([
        requestCancellation(event.id),
        requestCancellation(event.id),
      ]);

      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find(result => result.status === "rejected");
      expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      expect(((rejected as PromiseRejectedResult).reason as Error).message).toBe(
        EVENT_CANCELLATION_ALREADY_REQUESTED
      );
      expect(await requestsFor(event.id)).toHaveLength(1);
      expect(await notificationsFor(event.id, "event_cancellation_requested")).toHaveLength(1);
    });

    test("accepts a new request once the Coordinator has declined the last one", async () => {
      const event = await createEvent("planning");
      const first = await requestCancellation(event.id);
      await database
        .update(schema.eventCancellationRequests)
        .set({
          outcome: "declined",
          declineReason: "The deposit is paid.",
          processedById: coordinator.id,
          processedByName: coordinator.name,
          processedAt: new Date(),
        })
        .where(eq(schema.eventCancellationRequests.id, first.id));

      const second = await requestCancellation(event.id);

      const detail = await handleGetEventRequest({ id: event.id }, organiser, database as never);
      expect(detail?.cancellationRequests).toEqual([
        expect.objectContaining({ id: first.id, outcome: "declined" }),
        expect.objectContaining({ id: second.id, outcome: null }),
      ]);
    });

    test.each([
      { processedById: " ", processedByName: coordinator.name },
      { processedById: coordinator.id, processedByName: " " },
    ])("refuses a decided request with a blank processor (%o)", async processor => {
      const event = await createEvent("planning");
      const request = await requestCancellation(event.id);

      // Drizzle wraps the driver error, so the constraint name is on the cause, not the message.
      await expect(
        database
          .update(schema.eventCancellationRequests)
          .set({ outcome: "cancelled", processedAt: new Date(), ...processor })
          .where(eq(schema.eventCancellationRequests.id, request.id))
      ).rejects.toMatchObject({
        cause: { constraint: "event_cancellation_requests_outcome_complete" },
      });
    });

    test("shows the request on the assigned Coordinator's page", async () => {
      const event = await createEvent("planning");
      const request = await requestCancellation(event.id);

      const view = await handleGetCoordinationRequest(
        { id: event.id },
        coordinator,
        database as never
      );

      expect(view.cancellationRequests).toEqual([
        expect.objectContaining({ id: request.id, outcome: null }),
      ]);
    });

    test("notifies the assigned Coordinator and no one else (AC3)", async () => {
      const event = await createEvent("planning");

      await requestCancellation(event.id);

      const notices = await notificationsFor(event.id, "event_cancellation_requested");
      expect(notices).toHaveLength(1);
      const [notice] = notices;
      expect(notice.recipientId).toBe(coordinator.id);
      const notification = parsed(notice);
      expect(notificationSummary(notification)).toBe(
        `Event cancellation requested: ${event.eventName}`
      );
      expect(notificationHref(notification)).toBe(`/coordination/${event.id}`);
      expect(renderNotificationEmail(notification).subject).toBe(
        `Event cancellation requested: ${event.eventName}`
      );
    });

    test("leaves an unassigned event in the unassigned list, with no one to notify (AC3)", async () => {
      const event = await createEvent("submitted", { assigned: false });

      await requestCancellation(event.id);

      expect(await notificationsFor(event.id, "event_cancellation_requested")).toEqual([]);
      const unassigned = await handleListUnassignedEventRequests(database as never);
      expect(unassigned.map(row => row.id)).toContain(event.id);
    });

    test("leaves the event's status unchanged (AC4)", async () => {
      const event = await createEvent("confirmed");

      await requestCancellation(event.id);

      expect((await eventRow(event.id)).status).toBe("confirmed");
    });
  });
});
