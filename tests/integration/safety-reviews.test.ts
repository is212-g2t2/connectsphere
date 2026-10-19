// Use a local node-postgres Drizzle instance, as `event-confirmation.test.ts` does. Keep the
// app's `#/db` out of this file.
// oxlint-disable node/no-process-env
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { render } from "@react-email/components";

import * as schema from "#/db/schema";
import { runSeed } from "../../scripts/seed";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { handleListEvents } from "#/features/events/records.server";
import { deliverPendingNotifications } from "#/features/notifications/deliver.server";
import { handleListNotifications } from "#/features/notifications/inbox.server";
import { renderNotificationEmail } from "#/features/notifications/render.server";
import { arrangementFingerprint } from "#/features/safety-reviews/fingerprint.server";
import {
  handleDecideSafetyReview,
  handleGetEventSafetyReview,
  handleListSafetyReviews,
  handleRequestSafetyReReview,
} from "#/features/safety-reviews/reviews.server";
import {
  SAFETY_REVIEW_ALREADY_PENDING_MESSAGE,
  SAFETY_REVIEW_ARRANGEMENTS_INCOMPLETE_MESSAGE,
  SAFETY_REVIEW_NOT_PENDING_MESSAGE,
  SAFETY_REVIEW_NOT_REJECTED_MESSAGE,
  SAFETY_REVIEW_OUTDATED_MESSAGE,
  SAFETY_REVIEW_STALE_MESSAGE,
} from "#/features/safety-reviews/schema";
import { handleLiftVenueBlock, handleRecordVenueBlock } from "#/features/venues/blocks.server";

type Database = ReturnType<typeof drizzle<typeof schema>>;

/** Delivery sends no email here. Keep the mailer stubbed so the worker test cannot send. */
const sendEmail = vi.hoisted(() =>
  vi.fn<(to: string, subject: string, element: ReactElement) => Promise<void>>(
    async () => undefined
  )
);

vi.mock("#/lib/mailer.server", () => ({ sendEmail }));

const actor = (id: string, role: string, name = id): SessionUser => ({
  id,
  role,
  name,
  email: `${id}@x.test`,
});

const organiser = actor("test-user-2", "event_organiser");
const coordinator = actor("seed-coordinator-1", "event_coordinator", "Seeded Event Coordinator");
const lead = actor("seed-lead-1", "event_coordinator_lead", "Seeded Event Coordinator Lead");
const safetyOfficer = actor("safety-officer-1", "safety_officer", "Seeded Safety Officer");
const venueStaff = actor("seed-venue-staff-1", "venue_staff", "Seeded Venue Staff");

describe("reviewing an event's operational safety (PTR-146)", () => {
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
          id: safetyOfficer.id,
          name: safetyOfficer.name ?? "Safety Officer",
          email: "safety.officer@example.com",
          emailVerified: true,
          role: "safety_officer",
        },
      ])
      .onConflictDoNothing();

    const [venue] = await database.select().from(schema.venues).limit(1);
    venueId = venue.id;
    venueName = venue.name;
  });

  afterAll(async () => {
    await database.delete(schema.user).where(eq(schema.user.id, safetyOfficer.id));
    await pool.end();
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
    options: { coordinatorId?: string | null } = {}
  ) {
    const decided = !["draft", "submitted", "under_review", "awaiting_organiser"].includes(status);
    const confirmed = status === "confirmed";
    const completed = status === "completed";
    const cancelled = status === "cancelled";
    const coordinatorId =
      options.coordinatorId === undefined ? coordinator.id : options.coordinatorId;
    const [row] = await database
      .insert(schema.eventRequests)
      .values({
        organiserId: organiser.id,
        status,
        submittedAt: new Date(),
        assignedCoordinatorId: coordinatorId,
        ...(coordinatorId === null ? {} : { assignedAt: new Date() }),
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
        ...(completed
          ? {
              completedById: coordinator.id,
              completedByName: coordinator.name,
              completedAt: new Date("2030-01-02T00:00:00Z"),
            }
          : {}),
        ...(cancelled
          ? {
              cancelledById: coordinator.id,
              cancelledByName: coordinator.name,
              cancelledAt: new Date(),
            }
          : {}),
        equipmentArrangementsCompletedAt: new Date(),
        eventName: `Safety review test ${crypto.randomUUID()}`,
        purpose: "test",
        proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
        expectedAttendance: 10,
        eventType: "Conference",
        roomLayoutPreference: "Theatre",
      })
      .returning({ id: schema.eventRequests.id });
    created.push(row.id);
    return row.id;
  }

  async function createBooking(eventId: number, status: "approved" | "pending" = "approved") {
    const startsAt = "2041-03-10 09:00:00";
    const endsAt = "2041-03-10 12:30:00";
    const [row] = await database
      .insert(schema.venueRequests)
      .values({
        id: crypto.randomUUID(),
        eventId,
        venueId,
        requestedById: coordinator.id,
        startsAt,
        endsAt,
        status,
        expectedAttendance: 10,
        layout: "Theatre",
        accessibilityRequirements: "",
        requiredFacilities: "",
      })
      .returning({ id: schema.venueRequests.id });
    // An approved booking occupies the venue through its ledger row, as the approval path writes
    // it. A venue block then suspends the row, which the review list and the fingerprint read.
    if (status === "approved") {
      await database.insert(schema.venueOccupancy).values({
        venueId,
        eventId,
        venueRequestId: row.id,
        startsAt,
        endsAt,
        setupMinutes: 0,
        turnaroundMinutes: 0,
      });
    }
    return row.id;
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

  /** Create a review with the event's current fingerprint unless a stale one is asked for. */
  async function createReview(eventId: number, fingerprint?: string) {
    const covered = fingerprint ?? (await currentFingerprint(eventId));
    const [row] = await database
      .insert(schema.safetyReviews)
      .values({ eventRequestId: eventId, fingerprint: covered })
      .returning();
    return row;
  }

  const currentFingerprint = (eventId: number) =>
    arrangementFingerprint(database as never, eventId).then(value => {
      if (value === null) throw new Error(`No event ${eventId}`);
      return value;
    });

  const readReview = async (id: number) =>
    (await database.select().from(schema.safetyReviews).where(eq(schema.safetyReviews.id, id)))[0];

  const readEvent = async (id: number) =>
    (await database.select().from(schema.eventRequests).where(eq(schema.eventRequests.id, id)))[0];

  const decide = (
    reviewId: number,
    input: {
      decision: "approved" | "rejected" | "changes_requested";
      fingerprint: string;
      comments?: string;
    },
    as: SessionUser = safetyOfficer
  ) =>
    handleDecideSafetyReview(
      {
        reviewId,
        decision: input.decision,
        fingerprint: input.fingerprint,
        comments: input.comments ?? "",
      },
      as,
      database as never
    );

  const refusal = async (
    reviewId: number,
    input: {
      decision: "approved" | "rejected" | "changes_requested";
      fingerprint: string;
      comments?: string;
    }
  ) => {
    const error = await decide(reviewId, input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    return (error as Error).message;
  };

  const requestReReview = (eventId: number, as: SessionUser = coordinator) =>
    handleRequestSafetyReReview({ id: eventId }, as, database as never);

  /** Re-review refusals are conflicts with a named reason, as every review write refuses. */
  const reReviewRefusal = async (eventId: number, as: SessionUser = coordinator) => {
    const error = await requestReReview(eventId, as).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    return (error as Error).message;
  };

  const notificationsFor = (
    eventId: number,
    kind: "safety_review_decided" | "safety_review_requested"
  ) =>
    database
      .select()
      .from(schema.notifications)
      .where(
        and(eq(schema.notifications.eventRequestId, eventId), eq(schema.notifications.kind, kind))
      );

  // ── AC2 ────────────────────────────────────────────────────────────────────────────────────
  describe("the review list", () => {
    test("shows a current pending review on an approved event, with its venue", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);

      const list = await handleListSafetyReviews(database as never);

      const entry = list.find(row => row.id === review.id);
      expect(entry).toMatchObject({
        eventId,
        eventStatus: "approved",
        venue: { name: venueName, startTime: "09:00", endTime: "12:30" },
        current: true,
      });
    });

    test("shows a pending review on a planning event", async () => {
      const eventId = await createEvent("planning");
      await createBooking(eventId);
      const review = await createReview(eventId);

      const list = await handleListSafetyReviews(database as never);

      expect(list.find(row => row.id === review.id)?.eventStatus).toBe("planning");
    });

    test("marks a review whose arrangements changed as not current", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved");
      const review = await createReview(eventId);
      await createLine(eventId, "Microphone", "reserved");

      const list = await handleListSafetyReviews(database as never);

      expect(list.find(row => row.id === review.id)?.current).toBe(false);
    });

    test("shows no venue while a block suspends the booking, and marks the review not current", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      const block = await handleRecordVenueBlock(
        {
          venueId,
          date: "2041-03-10",
          startTime: "08:00",
          endDate: "2041-03-10",
          endTime: "13:00",
          reason: "PTR-146 list probe",
        },
        venueStaff,
        database as never
      );
      try {
        const list = await handleListSafetyReviews(database as never);

        expect(list.find(row => row.id === review.id)).toMatchObject({
          venue: null,
          current: false,
        });
      } finally {
        await handleLiftVenueBlock({ id: block.id }, venueStaff, database as never);
      }
    });

    test.each(["cancelled", "completed", "rejected"] as const)(
      "hides a pending review on a %s event",
      async status => {
        const eventId = await createEvent(status);
        await createBooking(eventId);
        const review = await createReview(eventId);

        const list = await handleListSafetyReviews(database as never);

        expect(list.find(row => row.id === review.id)).toBeUndefined();
      }
    );

    test("hides a decided review", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      await decide(review.id, { decision: "approved", fingerprint: review.fingerprint });

      const list = await handleListSafetyReviews(database as never);

      expect(list.find(row => row.id === review.id)).toBeUndefined();
    });
  });

  // ── AC3 ────────────────────────────────────────────────────────────────────────────────────
  describe("the decision", () => {
    test("records an approval with the acting Safety Officer and the time", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      const started = Date.now();

      const result = await decide(review.id, {
        decision: "approved",
        fingerprint: review.fingerprint,
      });

      expect(result).toEqual({ reviewId: review.id, eventId, state: "approved" });
      const row = await readReview(review.id);
      expect(row.state).toBe("approved");
      expect(row.decidedById).toBe(safetyOfficer.id);
      expect(row.decidedByName).toBe(safetyOfficer.name);
      expect(row.decidedAt?.getTime()).toBeGreaterThanOrEqual(started - 1000);
      expect((await readEvent(eventId)).status).toBe("approved");
    });

    test("moves an approved event to planning on a rejection, and records the comments", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);

      await decide(review.id, {
        decision: "rejected",
        fingerprint: review.fingerprint,
        comments: "The exits cannot take the crowd.",
      });

      const row = await readReview(review.id);
      expect(row.state).toBe("rejected");
      expect(row.comments).toBe("The exits cannot take the crowd.");
      expect((await readEvent(eventId)).status).toBe("planning");
    });

    test("moves an approved event to planning on a change request too", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);

      await decide(review.id, {
        decision: "changes_requested",
        fingerprint: review.fingerprint,
        comments: "Add a second exit.",
      });

      expect((await readReview(review.id)).state).toBe("changes_requested");
      expect((await readEvent(eventId)).status).toBe("planning");
    });

    test("leaves a planning event in planning", async () => {
      const eventId = await createEvent("planning");
      await createBooking(eventId);
      const review = await createReview(eventId);

      await decide(review.id, {
        decision: "rejected",
        fingerprint: review.fingerprint,
        comments: "No.",
      });

      expect((await readEvent(eventId)).status).toBe("planning");
    });

    test("refuses a second decision on the same review, and changes nothing", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      await decide(review.id, { decision: "approved", fingerprint: review.fingerprint });

      const message = await refusal(review.id, {
        decision: "rejected",
        fingerprint: review.fingerprint,
        comments: "Changed my mind.",
      });

      expect(message).toBe(SAFETY_REVIEW_NOT_PENDING_MESSAGE);
      const row = await readReview(review.id);
      expect(row.state).toBe("approved");
      expect(row.comments).toBeNull();
    });

    test("refuses a rendered fingerprint that no longer matches the review", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);

      const message = await refusal(review.id, {
        decision: "approved",
        fingerprint: "deadbeef",
      });

      expect(message).toBe(SAFETY_REVIEW_STALE_MESSAGE);
      expect((await readReview(review.id)).state).toBe("pending");
    });

    test("refuses a review whose arrangements changed after it was raised", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved");
      const review = await createReview(eventId);
      await database
        .update(schema.equipmentRequests)
        .set({ arrangementStatus: "requested" })
        .where(eq(schema.equipmentRequests.eventId, eventId));

      const message = await refusal(review.id, {
        decision: "approved",
        fingerprint: review.fingerprint,
      });

      expect(message).toBe(SAFETY_REVIEW_OUTDATED_MESSAGE);
      expect((await readReview(review.id)).state).toBe("pending");
    });

    test("refuses a decision on a cancelled event, and names its status", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      await database
        .update(schema.eventRequests)
        .set({
          status: "cancelled",
          cancelledById: coordinator.id,
          cancelledByName: coordinator.name,
          cancelledAt: new Date(),
        })
        .where(eq(schema.eventRequests.id, eventId));

      const message = await refusal(review.id, {
        decision: "approved",
        fingerprint: review.fingerprint,
      });

      expect(message).toContain("status is cancelled");
      expect((await readReview(review.id)).state).toBe("pending");
    });

    test("refuses a review that is not there", async () => {
      await expect(
        decide(987_654_321, { decision: "approved", fingerprint: "abc" })
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── AC4 ────────────────────────────────────────────────────────────────────────────────────
  describe("who is told", () => {
    test("notifies the Coordinator assigned at decision time with the comments", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);

      await decide(review.id, {
        decision: "changes_requested",
        fingerprint: review.fingerprint,
        comments: "Crowd movement needs a second exit.",
      });

      const rows = await notificationsFor(eventId, "safety_review_decided");
      expect(rows).toHaveLength(1);
      expect(rows[0].recipientId).toBe(coordinator.id);
      expect(rows[0].payload).toMatchObject({
        eventName: expect.stringContaining("Safety review test"),
        decision: "changes_requested",
        comments: "Crowd movement needs a second exit.",
      });
      const html = await render(
        renderNotificationEmail({
          kind: rows[0].kind,
          payload: rows[0].payload,
          eventRequestId: eventId,
        } as never).element
      );
      expect(html).toContain("second exit");
      // The assigned Coordinator can open the event, so the email links it.
      expect(html).toContain(`/events/${eventId}`);
    });

    test("notifies every Event Coordinator Lead when the event has none assigned", async () => {
      const eventId = await createEvent("approved", { coordinatorId: null });
      await createBooking(eventId);
      const review = await createReview(eventId);

      await decide(review.id, {
        decision: "approved",
        fingerprint: review.fingerprint,
      });

      const rows = await notificationsFor(eventId, "safety_review_decided");
      const leadRows = await database
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.role, "event_coordinator_lead"));
      expect(leadRows.length).toBeGreaterThan(0);
      expect(rows.map(row => row.recipientId).toSorted()).toEqual(
        leadRows.map(row => row.id).toSorted()
      );
    });

    test("raises nothing when the decision is refused", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);

      await refusal(review.id, { decision: "approved", fingerprint: "deadbeef" });

      expect(await notificationsFor(eventId, "safety_review_decided")).toHaveLength(0);
    });

    test("keeps a Lead's inbox row readable and linked to the event", async () => {
      const eventId = await createEvent("approved", { coordinatorId: null });
      await createBooking(eventId);
      const review = await createReview(eventId);
      await decide(review.id, { decision: "approved", fingerprint: review.fingerprint });

      const rows = await notificationsFor(eventId, "safety_review_decided");
      const raised = rows.find(row => row.recipientId === lead.id);
      const inbox = await handleListNotifications(lead, database);

      const entry = inbox.find(item => item.id === raised?.id);
      expect(entry?.summary).toContain("Safety review approved");
      // A Lead reaches every non-draft event (PTR-144), so the row opens the event page.
      expect(entry?.href).toBe(`/events/${eventId}`);

      // The email links the event too.
      const html = await render(
        renderNotificationEmail({
          kind: raised?.kind as "safety_review_decided",
          payload: raised?.payload as never,
          eventRequestId: eventId,
        }).element
      );
      expect(html).toContain(`/events/${eventId}`);

      // The row stays readable after the event gains a Coordinator: the decision named this
      // recipient, so a later assignment must not blank their row.
      await database
        .update(schema.eventRequests)
        .set({ assignedCoordinatorId: coordinator.id, assignedAt: new Date() })
        .where(eq(schema.eventRequests.id, eventId));
      const after = await handleListNotifications(lead, database);
      expect(after.find(item => item.id === raised?.id)?.summary).toContain(
        "Safety review approved"
      );
    });

    test("delivers the Lead's email with the event link", async () => {
      const eventId = await createEvent("approved", { coordinatorId: null });
      await createBooking(eventId);
      const review = await createReview(eventId);
      await decide(review.id, { decision: "approved", fingerprint: review.fingerprint });
      sendEmail.mockClear();

      await deliverPendingNotifications(database as never);

      const call = sendEmail.mock.calls.find(([to]) => to === "lead.seed@example.com");
      expect(call).toBeDefined();
      const html = await render(call?.[2] as ReactElement);
      expect(html).toContain("Safety review approved");
      expect(html).toContain(`/events/${eventId}`);
    });

    test("links the assigned Coordinator's inbox row to the event", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      await decide(review.id, { decision: "approved", fingerprint: review.fingerprint });

      const [raised] = await notificationsFor(eventId, "safety_review_decided");
      const inbox = await handleListNotifications(coordinator, database);

      const entry = inbox.find(item => item.id === raised.id);
      expect(entry?.summary).toContain("Safety review approved");
      expect(entry?.href).toBe(`/events/${eventId}`);
    });
  });

  // ── AC1 and AC5 ───────────────────────────────────────────────────────────────────────────
  describe("what the Safety Officer reads", () => {
    test("reads the event with its venue, capacity, layout and equipment", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createLine(eventId, "Projector", "reserved", 2);
      await createReview(eventId);

      const [entry] = await handleListEvents({ eventId }, safetyOfficer, database as never);

      expect(entry.access).toBe("safety_officer");
      expect(entry.event).toMatchObject({
        status: "approved",
        layout: "Theatre",
        expectedAttendance: 10,
        venue: { name: venueName, startTime: "09:00", endTime: "12:30" },
        // PTR-138: the current booking's own session requirements, which the fingerprint hashes.
        sessionRequirements: {
          expectedAttendance: 10,
          layout: "Theatre",
          accessibilityRequirements: "",
          requiredFacilities: "",
        },
        equipment: [
          { item: "Projector", quantity: 2, arrangementStatus: "reserved", reservedQuantity: null },
        ],
      });
      expect(entry.event.venueCapacity).toBeGreaterThan(0);
      // The booking decisions stay out of this projection.
      expect(entry.event).not.toHaveProperty("venueRequests");
      expect(entry.event).not.toHaveProperty("confirmation");
    });

    test("reads the event's current review with the fingerprint the page renders", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);

      const detail = await handleGetEventSafetyReview({ id: eventId }, database as never);

      expect(detail).toMatchObject({
        id: review.id,
        state: "pending",
        fingerprint: review.fingerprint,
        current: true,
      });
    });

    test("refuses an event that has no review", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);

      await expect(
        handleListEvents({ eventId }, safetyOfficer, database as never)
      ).rejects.toMatchObject({ name: "AuthorizationError", message: "Forbidden" });
    });
  });

  // ── PTR-158 AC1 ───────────────────────────────────────────────────────────────────────────
  describe("the Coordinator asks for a fresh review", () => {
    test("creates a pending review for the current arrangements and tells every Safety Officer", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const rejected = await createReview(eventId);
      await decide(rejected.id, {
        decision: "changes_requested",
        fingerprint: rejected.fingerprint,
        comments: "Add a second exit.",
      });

      const result = await requestReReview(eventId);

      const newReview = await readReview(result.reviewId);
      expect(newReview).toMatchObject({
        eventRequestId: eventId,
        state: "pending",
        fingerprint: await currentFingerprint(eventId),
      });
      expect(newReview.id).not.toBe(rejected.id);
      expect((await readEvent(eventId)).status).toBe("planning");

      const officers = await database
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.role, "safety_officer"));
      const notices = await notificationsFor(eventId, "safety_review_requested");
      expect(officers.length).toBeGreaterThan(0);
      expect(notices.map(row => row.recipientId).toSorted()).toEqual(
        officers.map(row => row.id).toSorted()
      );
      expect(notices[0].payload).toMatchObject({
        eventName: expect.stringContaining("Safety review test"),
      });
    });

    test("refuses a review that is still pending, with the reason named", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createReview(eventId);

      expect(await reReviewRefusal(eventId)).toBe(SAFETY_REVIEW_ALREADY_PENDING_MESSAGE);
      expect(await notificationsFor(eventId, "safety_review_requested")).toHaveLength(0);
    });

    test("refuses when the latest review approved the arrangements", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      await decide(review.id, { decision: "approved", fingerprint: review.fingerprint });

      expect(await reReviewRefusal(eventId)).toBe(SAFETY_REVIEW_NOT_REJECTED_MESSAGE);
    });

    test("refuses an event with no review", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);

      expect(await reReviewRefusal(eventId)).toBe(SAFETY_REVIEW_NOT_REJECTED_MESSAGE);
    });

    test("refuses arrangements that are not complete", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      await decide(review.id, {
        decision: "rejected",
        fingerprint: review.fingerprint,
        comments: "No.",
      });
      await createLine(eventId, "Projector", "requested");

      expect(await reReviewRefusal(eventId)).toBe(SAFETY_REVIEW_ARRANGEMENTS_INCOMPLETE_MESSAGE);
    });

    test.each(["confirmed", "cancelled", "completed", "submitted"] as const)(
      "refuses a %s event, naming its status",
      async status => {
        const eventId = await createEvent(status);
        await createBooking(eventId);
        await createReview(eventId);

        expect(await reReviewRefusal(eventId)).toContain(`status is ${status}`);
      }
    );

    test("refuses a Coordinator the event is not assigned to", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      const review = await createReview(eventId);
      await decide(review.id, {
        decision: "rejected",
        fingerprint: review.fingerprint,
        comments: "No.",
      });

      await expect(
        requestReReview(eventId, actor("other-coordinator", "event_coordinator"))
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    test("refuses a missing event as Forbidden", async () => {
      await expect(requestReReview(987_654_321)).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  // ── PTR-158 AC2 ───────────────────────────────────────────────────────────────────────────
  describe("the safety stage on the detail page", () => {
    test("fills the stage for the Organiser and Coordinator, and only on the named event", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);

      const [beforeReview] = await handleListEvents({ eventId }, coordinator, database as never);
      expect(beforeReview.event.safetyStage).toBeNull();

      await createReview(eventId);
      const [current] = await handleListEvents({ eventId }, coordinator, database as never);
      expect(current.event.safetyStage).toEqual({ state: "pending", current: true });

      await createLine(eventId, "Projector", "reserved");
      const [organiserView] = await handleListEvents({ eventId }, organiser, database as never);
      expect(organiserView.event.safetyStage).toEqual({ state: "pending", current: false });

      // The list read carries no stage, so cards keep the plain status.
      const list = await handleListEvents({}, coordinator, database as never);
      const row = list.find(projection => projection.event.id === eventId);
      expect(row?.event).not.toHaveProperty("safetyStage");
    });
  });

  // ── AC3 data integrity ────────────────────────────────────────────────────────────────────
  describe("the database", () => {
    test("refuses a second pending review for one event", async () => {
      const eventId = await createEvent();
      await createBooking(eventId);
      await createReview(eventId);

      await expect(createReview(eventId)).rejects.toThrow("Failed query");
    });

    test("refuses comments on a pending review", async () => {
      const eventId = await createEvent();

      await expect(
        database
          .insert(schema.safetyReviews)
          .values({ eventRequestId: eventId, fingerprint: "abc", comments: "Early" })
      ).rejects.toThrow("Failed query");
    });

    test("refuses a decided review with no actor", async () => {
      const eventId = await createEvent();
      const review = await createReview(eventId);

      await expect(
        database
          .update(schema.safetyReviews)
          .set({ state: "approved" })
          .where(eq(schema.safetyReviews.id, review.id))
      ).rejects.toThrow("Failed query");
    });

    test("refuses a rejection with no comments", async () => {
      const eventId = await createEvent();
      const review = await createReview(eventId);

      await expect(
        database
          .update(schema.safetyReviews)
          .set({
            state: "rejected",
            decidedById: safetyOfficer.id,
            decidedByName: safetyOfficer.name,
            decidedAt: new Date(),
          })
          .where(eq(schema.safetyReviews.id, review.id))
      ).rejects.toThrow("Failed query");
    });
  });
});
