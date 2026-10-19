import { and, asc, desc, eq, inArray, notExists } from "drizzle-orm";

import type { db as Db } from "#/db";
import { eventRequests, safetyReviews, venueOccupancy, venueRequests, venues } from "#/db/schema";
import { ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { listLeadIds } from "#/features/event-requests/leads.server";
import { EVENT_REQUEST_STATUS_LABELS, parseEventRequestId } from "#/features/event-requests/schema";
import { raiseNotifications } from "#/features/notifications/raise.server";
import {
  arrangementFingerprint,
  arrangementFingerprintOf,
  loadArrangementFingerprintInputs,
} from "#/features/safety-reviews/fingerprint.server";
import {
  parseSafetyReviewDecision,
  SAFETY_REVIEW_NOT_PENDING_MESSAGE,
  SAFETY_REVIEW_OUTDATED_MESSAGE,
  SAFETY_REVIEW_STALE_MESSAGE,
} from "#/features/safety-reviews/schema";
import type {
  PendingSafetyReview,
  SafetyReviewDecision,
  SafetyReviewDetail,
} from "#/features/safety-reviews/schema";
import { suspendedPieceWhere } from "#/features/venues/blocked-arrangements.server";

/**
 * Keep this module server-only: `#/db/schema` is a value import. `server-fns.ts` loads it
 * dynamically inside `.handler()`. Middleware already verified the session and the
 * `safety_review` permission.
 */

type Database = typeof Db;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * PTR-146 AC2: The Safety Officer's list. Show each pending review on an approved or planning
 * event. A review on a cancelled, completed or rejected event does not show, and neither does a
 * decided one. Mark a pending review whose fingerprint no longer matches the arrangements as not
 * current; the page then labels it "Withdrawn: arrangements changed".
 */
export async function handleListSafetyReviews(database: Database): Promise<PendingSafetyReview[]> {
  const rows = await database
    .select({
      id: safetyReviews.id,
      eventId: safetyReviews.eventRequestId,
      fingerprint: safetyReviews.fingerprint,
      createdAt: safetyReviews.createdAt,
      eventName: eventRequests.eventName,
      eventStatus: eventRequests.status,
    })
    .from(safetyReviews)
    .innerJoin(eventRequests, eq(eventRequests.id, safetyReviews.eventRequestId))
    .where(
      and(
        eq(safetyReviews.state, "pending"),
        inArray(eventRequests.status, ["approved", "planning"])
      )
    )
    .orderBy(asc(safetyReviews.createdAt), asc(safetyReviews.id));
  if (rows.length === 0) return [];

  const eventIds = rows.map(row => row.eventId);
  const [fingerprints, bookings] = await Promise.all([
    loadArrangementFingerprintInputs(database, eventIds),
    database
      .select({
        eventId: venueRequests.eventId,
        venueName: venues.name,
        startsAt: venueRequests.startsAt,
        endsAt: venueRequests.endsAt,
      })
      .from(venueRequests)
      .innerJoin(venues, eq(venues.id, venueRequests.venueId))
      .where(
        and(
          inArray(venueRequests.eventId, eventIds),
          eq(venueRequests.status, "approved"),
          // PTR-137: a booking a live venue block suspends is not the event's current venue, as
          // `loadCurrentBookings` states for the event page.
          notExists(
            database
              .select({ id: venueOccupancy.id })
              .from(venueOccupancy)
              .where(
                and(suspendedPieceWhere(), eq(venueOccupancy.venueRequestId, venueRequests.id))
              )
          )
        )
      )
      .orderBy(asc(venueRequests.createdAt), asc(venueRequests.id)),
  ]);

  const bookingByEvent = new Map<number, (typeof bookings)[number]>();
  for (const booking of bookings) {
    if (!bookingByEvent.has(booking.eventId)) bookingByEvent.set(booking.eventId, booking);
  }

  return rows.map(row => {
    const input = fingerprints.get(row.eventId);
    const booking = bookingByEvent.get(row.eventId);
    return {
      id: row.id,
      eventId: row.eventId,
      eventName: row.eventName,
      eventStatus: row.eventStatus,
      venueName: booking?.venueName ?? null,
      startsAt: booking?.startsAt ?? null,
      endsAt: booking?.endsAt ?? null,
      createdAt: row.createdAt.toISOString(),
      // A review on a deleted event cannot happen (the foreign key cascades), so a missing input
      // means the read raced the event's deletion. Treat it as not current.
      current: input !== undefined && arrangementFingerprintOf(input) === row.fingerprint,
    };
  });
}

/**
 * PTR-146 AC5: Read the event's current review for its page. Any role may not call this: the
 * server function's middleware holds the `safety_review:read` permission, and the event page only
 * carries the review for the Safety Officer's access.
 */
export async function handleGetEventSafetyReview(
  data: unknown,
  database: Database
): Promise<SafetyReviewDetail | null> {
  const input = parseEventRequestId(data);
  const review = (
    await database
      .select()
      .from(safetyReviews)
      .where(eq(safetyReviews.eventRequestId, input.id))
      .orderBy(desc(safetyReviews.createdAt), desc(safetyReviews.id))
      .limit(1)
  ).at(0);
  if (!review) return null;

  const current = await arrangementFingerprint(database, input.id);
  return {
    id: review.id,
    state: review.state,
    fingerprint: review.fingerprint,
    comments: review.comments,
    decidedByName: review.decidedByName,
    decidedAt: review.decidedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
    current: current !== null && current === review.fingerprint,
  };
}

/** The review a decision settled, and the event it belongs to. */
interface SafetyReviewDecisionResult {
  reviewId: number;
  eventId: number;
  state: SafetyReviewDecision;
}

/**
 * PTR-146 AC3 and AC4: The Safety Officer decides a pending review. Lock the event row first, as
 * every event writer does, then re-read the review under that lock. Recompute the fingerprint and
 * refuse, with the reason named, when the review is no longer pending, no longer current, or when
 * the rendered fingerprint no longer matches the review.
 *
 * A rejection or a change request moves an approved event to planning in the same transaction.
 * Nothing is cancelled. Tell the Coordinator assigned at decision time, or every Lead when the
 * event has none, with the comments.
 */
export async function handleDecideSafetyReview(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<SafetyReviewDecisionResult> {
  const input = parseSafetyReviewDecision(data);

  return database.transaction(async tx => {
    // Read the review to learn its event, then take the event lock. The re-read below is the one
    // the decision trusts.
    const located = (
      await tx
        .select({ eventRequestId: safetyReviews.eventRequestId })
        .from(safetyReviews)
        .where(eq(safetyReviews.id, input.reviewId))
    ).at(0);
    if (!located) throw new NotFoundError("This safety review is not there.");

    const event = (
      await tx
        .select()
        .from(eventRequests)
        .where(eq(eventRequests.id, located.eventRequestId))
        .for("update")
    ).at(0);
    if (!event) throw new NotFoundError("This safety review is not there.");

    const review = (
      await tx
        .select()
        .from(safetyReviews)
        .where(eq(safetyReviews.id, input.reviewId))
        .for("update")
    ).at(0);
    if (!review || review.state !== "pending") {
      throw new ConflictError(SAFETY_REVIEW_NOT_PENDING_MESSAGE);
    }
    if (event.status !== "approved" && event.status !== "planning") {
      throw new ConflictError(
        `This event's safety review cannot be decided while its status is ${EVENT_REQUEST_STATUS_LABELS[event.status].toLowerCase()}.`
      );
    }

    const current = await arrangementFingerprint(tx, event.id);
    if (current === null || current !== review.fingerprint) {
      throw new ConflictError(SAFETY_REVIEW_OUTDATED_MESSAGE);
    }
    if (input.fingerprint !== review.fingerprint) {
      throw new ConflictError(SAFETY_REVIEW_STALE_MESSAGE);
    }

    const decidedAt = new Date();
    const decided = (
      await tx
        .update(safetyReviews)
        .set({
          state: input.decision,
          comments: input.comments === "" ? null : input.comments,
          decidedById: actor.id,
          decidedByName: actor.name?.trim() || actor.email,
          decidedAt,
        })
        .where(and(eq(safetyReviews.id, review.id), eq(safetyReviews.state, "pending")))
        .returning({ id: safetyReviews.id })
    ).at(0);
    if (!decided) throw new ConflictError(SAFETY_REVIEW_NOT_PENDING_MESSAGE);

    if (
      (input.decision === "rejected" || input.decision === "changes_requested") &&
      event.status === "approved"
    ) {
      await tx
        .update(eventRequests)
        .set({ status: "planning" })
        .where(eq(eventRequests.id, event.id));
    }

    const recipients = await safetyDecisionRecipients(tx, event.assignedCoordinatorId);
    await raiseNotifications(
      tx,
      recipients.map(recipientId => ({
        recipientId,
        eventRequestId: event.id,
        kind: "safety_review_decided" as const,
        payload: {
          eventName: event.eventName.trim() || "Untitled event",
          decision: input.decision,
          comments: input.comments,
        },
      }))
    );

    return { reviewId: review.id, eventId: event.id, state: input.decision };
  });
}

/**
 * PTR-146 AC4: the Coordinator assigned at decision time, or every Event Coordinator Lead when
 * the event has none (PTR-144). Reuse the shared fan-out, which holds the Lead accounts for the
 * caller's transaction.
 */
async function safetyDecisionRecipients(
  tx: Tx,
  assignedCoordinatorId: string | null
): Promise<string[]> {
  if (assignedCoordinatorId !== null) return [assignedCoordinatorId];
  return listLeadIds(tx);
}
