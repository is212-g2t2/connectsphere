import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import type { db as Db } from "#/db";
import {
  equipmentRequests,
  eventRequests,
  safetyReviews,
  venueOccupancy,
  venueRequests,
  venues,
} from "#/db/schema";
import { AuthorizationError, ConflictError, NotFoundError } from "#/features/auth/session";
import type { SessionUser } from "#/features/auth/session";
import { listLeadIds } from "#/features/event-requests/leads.server";
import { EVENT_REQUEST_STATUS_LABELS, parseEventRequestId } from "#/features/event-requests/schema";
import { arrangementBlockers, isConfirmableStatus } from "#/features/events/confirmation";
import { loadCurrentBookings } from "#/features/events/records.server";
import { raiseNotifications } from "#/features/notifications/raise.server";
import {
  arrangementFingerprint,
  arrangementFingerprintOf,
  loadArrangementFingerprintInputs,
} from "#/features/safety-reviews/fingerprint.server";
import {
  parseSafetyReviewDecision,
  SAFETY_REVIEW_ALREADY_PENDING_MESSAGE,
  SAFETY_REVIEW_ARRANGEMENTS_INCOMPLETE_MESSAGE,
  SAFETY_REVIEW_NOT_PENDING_MESSAGE,
  SAFETY_REVIEW_NOT_REJECTED_MESSAGE,
  SAFETY_REVIEW_OUTDATED_MESSAGE,
  SAFETY_REVIEW_REQUEST_RETRY_MESSAGE,
  SAFETY_REVIEW_RETRY_MESSAGE,
  SAFETY_REVIEW_STALE_MESSAGE,
  SAFETY_REVIEW_STARTED_MESSAGE,
} from "#/features/safety-reviews/schema";
import type {
  PendingSafetyReview,
  SafetyReviewDecision,
  SafetyReviewDetail,
} from "#/features/safety-reviews/schema";
import { hasEventStarted, notifySafetyOfficers } from "#/features/safety-reviews/sweep.server";
import { isDeadlock } from "#/features/venue-requests/occupancy.server";
import { suspendedPieceWhere } from "#/features/venues/blocked-arrangements.server";
import { logger } from "#/lib/logger";

/**
 * Keep this module server-only: `#/db/schema` is a value import. `server-fns.ts` loads it
 * dynamically inside `.handler()`. Middleware already verified the session and the
 * `safety_review` permission.
 */

type Database = typeof Db;

const log = logger.getChild("safety-reviews");

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
      refreshedAt: safetyReviews.refreshedAt,
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
    // The same current-booking rule the event page uses: the earliest approved booking that no
    // live venue block suspends.
    loadCurrentBookings(database, eventIds),
  ]);

  return rows.map(row => {
    const input = fingerprints.get(row.eventId);
    return {
      id: row.id,
      eventId: row.eventId,
      eventName: row.eventName,
      eventStatus: row.eventStatus,
      venue: bookings.get(row.eventId)?.venue ?? null,
      createdAt: row.createdAt.toISOString(),
      updated: row.refreshedAt !== null,
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
      .select({ review: safetyReviews, eventStatus: eventRequests.status })
      .from(safetyReviews)
      .innerJoin(eventRequests, eq(eventRequests.id, safetyReviews.eventRequestId))
      .where(eq(safetyReviews.eventRequestId, input.id))
      .orderBy(desc(safetyReviews.createdAt), desc(safetyReviews.id))
      .limit(1)
  ).at(0);
  // A draft has no review; the guard keeps this read on the same rule as the event access helpers.
  if (!review || review.eventStatus === "draft") return null;
  const { review: row } = review;

  const current = await arrangementFingerprint(database, input.id);
  return {
    id: row.id,
    state: row.state,
    fingerprint: row.fingerprint,
    comments: row.comments,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    current: current !== null && current === row.fingerprint,
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

  return database
    .transaction(async tx => {
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

      // PTR-146 AC4: the Coordinator assigned at decision time, or every Event Coordinator Lead
      // when the event has none (PTR-144). Reuse the shared fan-out, which holds the Lead accounts
      // for this transaction.
      const recipients =
        event.assignedCoordinatorId !== null
          ? [event.assignedCoordinatorId]
          : await listLeadIds(tx);
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
    })
    .catch(error => rethrowSafetyReviewDeadlock(error, SAFETY_REVIEW_RETRY_MESSAGE));
}

/** The pending review the Coordinator's request created. */
interface SafetyReReviewResult {
  reviewId: number;
  eventId: number;
}

/**
 * PTR-158 AC1: the assigned Coordinator asks for a fresh review after a fix the system cannot see.
 * Lock the event row first, as every event writer does, then re-read the review under that lock.
 * Refuse, with the reason named, a foreign or missing event, any status but approved or planning,
 * a latest review that is not rejected or changes requested, a pending review, a started event,
 * and incomplete arrangements. A new pending review covers the current fingerprint, and every
 * Safety Officer is told. The refresh is the sweep's job; this action never edits an existing
 * review.
 */
export async function handleRequestSafetyReReview(
  data: unknown,
  actor: SessionUser,
  database: Database
): Promise<SafetyReReviewResult> {
  const input = parseEventRequestId(data);

  return database
    .transaction(async tx => {
      const event = (
        await tx.select().from(eventRequests).where(eq(eventRequests.id, input.id)).for("update")
      ).at(0);
      // Refuse a missing event and another user's event in the same way. The refusal then reveals
      // nothing about the id.
      if (!event || event.status === "draft" || event.assignedCoordinatorId !== actor.id) {
        throw new AuthorizationError("Forbidden");
      }
      if (!isConfirmableStatus(event.status)) {
        throw new ConflictError(
          `This event's safety review cannot be requested again while its status is ${EVENT_REQUEST_STATUS_LABELS[event.status].toLowerCase()}.`
        );
      }

      const review = (
        await tx
          .select()
          .from(safetyReviews)
          .where(eq(safetyReviews.eventRequestId, event.id))
          .orderBy(desc(safetyReviews.createdAt), desc(safetyReviews.id))
          .limit(1)
          .for("update")
      ).at(0);
      if (review?.state === "pending") {
        throw new ConflictError(SAFETY_REVIEW_ALREADY_PENDING_MESSAGE);
      }
      if (review?.state !== "rejected" && review?.state !== "changes_requested") {
        throw new ConflictError(SAFETY_REVIEW_NOT_REJECTED_MESSAGE);
      }

      // PTR-148's entry rule: the arrangements must be complete before a review covers them. Read
      // the same inputs as the sweep and the confirmation gate.
      const [venueRows, equipment, suspended] = await Promise.all([
        tx
          .select({
            id: venueRequests.id,
            status: venueRequests.status,
            venueName: venues.name,
            startsAt: venueRequests.startsAt,
            endsAt: venueRequests.endsAt,
            replacesRequestId: venueRequests.replacesRequestId,
            dismissedAt: venueRequests.dismissedAt,
          })
          .from(venueRequests)
          .innerJoin(venues, eq(venues.id, venueRequests.venueId))
          .where(eq(venueRequests.eventId, event.id)),
        tx.select().from(equipmentRequests).where(eq(equipmentRequests.eventId, event.id)),
        tx
          .select({ id: venueOccupancy.id })
          .from(venueOccupancy)
          .where(and(suspendedPieceWhere(event.id), isNotNull(venueOccupancy.venueRequestId)))
          .limit(1),
      ]);
      // PTR-148 AC4: a started event keeps its arrangements. The sweep skips it, so this path
      // must not leave an undecidable pending review behind.
      if (hasEventStarted(venueRows, new Date())) {
        throw new ConflictError(SAFETY_REVIEW_STARTED_MESSAGE);
      }
      const blockers = arrangementBlockers({
        venueRequests: venueRows,
        venueBookingSuspended: suspended.length > 0,
        equipmentLines: equipment,
        equipmentArrangementsCompletedAt: event.equipmentArrangementsCompletedAt,
      });
      if (blockers.length > 0) {
        throw new ConflictError(SAFETY_REVIEW_ARRANGEMENTS_INCOMPLETE_MESSAGE);
      }

      const fingerprint = await arrangementFingerprint(tx, event.id);
      if (fingerprint === null) throw new NotFoundError("This event is not there.");
      const created = (
        await tx
          .insert(safetyReviews)
          .values({ eventRequestId: event.id, fingerprint })
          .returning({ id: safetyReviews.id })
      ).at(0);
      if (!created) throw new ConflictError(SAFETY_REVIEW_REQUEST_RETRY_MESSAGE);

      // PTR-158 AC1: every Safety Officer receives the notice. The sweep uses the same fan-out.
      await notifySafetyOfficers(tx, event);

      return { reviewId: created.id, eventId: event.id };
    })
    .catch(error => rethrowSafetyReviewDeadlock(error, SAFETY_REVIEW_REQUEST_RETRY_MESSAGE));
}

/**
 * Map a deadlock (40P01) to the retry refusal, as the venue block writers do. The decision holds
 * the event row and then key-shares every Lead account for the fan-out; a Lead deletion takes the
 * account first and then its event rows, so Postgres can abort one of two concurrent writers.
 */
function rethrowSafetyReviewDeadlock(error: unknown, message: string): never {
  if (isDeadlock(error)) {
    log.warn("Refused a safety review write that deadlocked", { sqlstate: "40P01" });
    throw new ConflictError(message);
  }
  throw error;
}
