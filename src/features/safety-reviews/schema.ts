import { z } from "zod";

import type { EventVenue } from "#/features/events/access";
import type { EventRequestStatus } from "#/features/event-requests/schema";

/** Routes and forms import this module. Keep it free of server-only dependencies. */

/**
 * PTR-146: the four states of a safety review row. The Postgres enum in `#/db/schema` restates
 * this list; `tests/unit/db-schema.test.ts` keeps both in sync.
 */
export const SAFETY_REVIEW_STATES = [
  "pending",
  "approved",
  "rejected",
  "changes_requested",
] as const;

export type SafetyReviewState = (typeof SAFETY_REVIEW_STATES)[number];

/** PTR-146 AC3: the three decisions a Safety Officer records. `pending` is not a decision. */
export const SAFETY_REVIEW_DECISIONS = ["approved", "rejected", "changes_requested"] as const;

export type SafetyReviewDecision = (typeof SAFETY_REVIEW_DECISIONS)[number];

/** PTR-146: the human label of each review state. PTR-158 reuses these for the event's stage. */
export const SAFETY_REVIEW_STATE_LABELS: Record<SafetyReviewState, string> = {
  pending: "Awaiting safety review",
  approved: "Safety approved",
  rejected: "Safety rejected",
  changes_requested: "Safety changes requested",
};

/** PTR-158 AC2: a review that no longer covers the arrangements cannot give a current stage. */
export const SAFETY_REVIEW_OUT_OF_DATE_LABEL = "Safety review out of date";

/** PTR-158 AC2: the review facts the event's detail page needs to name its stage. */
export interface SafetyReviewStage {
  state: SafetyReviewState;
  /** False when the arrangements changed after the review was raised or decided. */
  current: boolean;
}

/**
 * PTR-158 AC2: the stage label an Organiser or Coordinator reads instead of the plain status.
 * Safety sits between planning and confirmation, so a confirmed or closed event keeps its status.
 * A review that no longer covers the arrangements reads out of date, whatever its state.
 */
export function safetyReviewStageLabel(
  status: EventRequestStatus,
  review: SafetyReviewStage | null | undefined
): string | null {
  if (status !== "approved" && status !== "planning") return null;
  if (!review) return null;
  if (!review.current) return SAFETY_REVIEW_OUT_OF_DATE_LABEL;
  return SAFETY_REVIEW_STATE_LABELS[review.state];
}

/** PTR-146: the decision as prose, shared by the notification summary and the email. */
export function safetyReviewDecisionLabel(decision: SafetyReviewDecision): string {
  return decision.replaceAll("_", " ");
}

/** PTR-146 AC2: the row label the Safety Officer's list shows for a withdrawn review. */
export const SAFETY_REVIEW_WITHDRAWN_LABEL = "Withdrawn: arrangements changed";

/**
 * PTR-146 AC3: the three refusals a decision can meet, each named. `NOT_PENDING` covers a
 * decision already recorded, `OUTDATED` a review whose arrangements changed after it was raised,
 * and `STALE` a page whose rendered fingerprint no longer matches its review.
 */
export const SAFETY_REVIEW_NOT_PENDING_MESSAGE = "This safety review has already been decided.";
export const SAFETY_REVIEW_OUTDATED_MESSAGE =
  "The arrangements changed after this review was raised.";
export const SAFETY_REVIEW_STALE_MESSAGE = "Arrangements changed since you opened this review.";
/** PTR-146: a deadlock aborts the decision; the caller retries, as the venue block writers do. */
export const SAFETY_REVIEW_RETRY_MESSAGE =
  "Another change conflicted with this decision. Try again.";
/** PTR-158: the same retry rule for the Coordinator's re-review request. */
export const SAFETY_REVIEW_REQUEST_RETRY_MESSAGE =
  "Another change conflicted with this request. Try again.";

/**
 * PTR-158 AC1: the Coordinator asks for a fresh review after a fix the system cannot see. The
 * action needs a rejected or changes-requested review, complete arrangements, and no pending one.
 */
export const SAFETY_REVIEW_ALREADY_PENDING_MESSAGE =
  "A safety review is already pending for this event.";
export const SAFETY_REVIEW_NOT_REJECTED_MESSAGE =
  "This event has no rejected or changes-requested safety review.";
export const SAFETY_REVIEW_ARRANGEMENTS_INCOMPLETE_MESSAGE =
  "The arrangements are not complete yet. The safety review starts when they are.";

export const SAFETY_REVIEW_COMMENTS_MAX = 2000;
export const SAFETY_REVIEW_COMMENTS_MESSAGE = `Comments must be ${SAFETY_REVIEW_COMMENTS_MAX} characters or fewer`;
export const SAFETY_REVIEW_COMMENTS_REQUIRED_MESSAGE =
  "Give the reason for your decision. The Coordinator receives these comments.";

/**
 * PTR-146: the event's current review, as the event page reads it. The decision form carries
 * `fingerprint` back, so a decision made against arrangements that have since changed is refused.
 */
export interface SafetyReviewDetail {
  id: number;
  state: SafetyReviewState;
  fingerprint: string;
  comments: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** False when the arrangements changed after the review was raised. */
  current: boolean;
}

/** PTR-146 AC2: one pending review on the Safety Officer's list. */
export interface PendingSafetyReview {
  updated: boolean;
  id: number;
  eventId: number;
  eventName: string;
  eventStatus: EventRequestStatus;
  /** The event's current approved booking, as the event page reads it. Null when none is current. */
  venue: EventVenue | null;
  createdAt: string;
  /** False when the arrangements changed after the review was raised. */
  current: boolean;
}

/**
 * PTR-146 AC3: one decision on one review. The fingerprint is the value the page rendered, so a
 * decision made against arrangements that have since changed is refused instead of recorded.
 * A rejection and a change request carry the comments that explain them; an approval may.
 */
export const SafetyReviewDecisionInput = z
  .object({
    reviewId: z.int32({ error: "Choose a safety review" }).positive("Choose a safety review"),
    decision: z.enum(SAFETY_REVIEW_DECISIONS, {
      error: "Choose approve, reject or request changes",
    }),
    fingerprint: z
      .string({ error: "Reload the review before you decide" })
      .min(1, "Reload the review before you decide"),
    comments: z
      .string()
      .trim()
      .max(SAFETY_REVIEW_COMMENTS_MAX, SAFETY_REVIEW_COMMENTS_MESSAGE)
      .default(""),
  })
  .refine(input => input.decision === "approved" || input.comments !== "", {
    error: SAFETY_REVIEW_COMMENTS_REQUIRED_MESSAGE,
    // Name the field, so a form maps the message onto the comments input.
    path: ["comments"],
  });

export function parseSafetyReviewDecision(data: unknown) {
  const parsed = SafetyReviewDecisionInput.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}
