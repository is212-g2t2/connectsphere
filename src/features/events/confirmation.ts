import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import { isArrangedLine, isEquipmentArrangementsSatisfied } from "#/features/events/access";
import { formatVenuePeriod } from "#/features/event-requests/format";
import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { answeredByReplacement } from "#/features/venue-requests/schema";
import type { VenueRequestAnswerRow } from "#/features/venue-requests/schema";
import type { SafetyReviewState } from "#/features/safety-reviews/schema";

/**
 * PTR-24 AC1/AC2: List the stages an event can be confirmed from. `approved` is where a decision
 * leaves the request. `planning` covers arrangement work and the safety review gate before
 * confirmation.
 */
const CONFIRMABLE_STATUSES = [
  "approved",
  "planning",
] as const satisfies readonly EventRequestStatus[];

export function isConfirmableStatus(status: EventRequestStatus): boolean {
  return CONFIRMABLE_STATUSES.some(confirmable => confirmable === status);
}

export const CONFIRMATION_REFUSAL_HEADING = "This event cannot be confirmed yet:";
export const VENUE_BOOKING_OUTSTANDING_MESSAGE = "There is no approved venue booking.";
/** PTR-137 AC2: a block suspends the booking, so the event cannot be confirmed on it. */
export const VENUE_BOOKING_SUSPENDED_MESSAGE = "Its venue booking is suspended by a venue block.";
export const EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE =
  "Technical Support has not marked the equipment arrangements complete.";
export const SAFETY_REVIEW_PENDING_MESSAGE = "The safety review is pending.";
export const SAFETY_REVIEW_REJECTED_MESSAGE = "The safety review was rejected.";
export const SAFETY_REVIEW_CHANGES_REQUESTED_MESSAGE = "The Safety Officer requested changes.";
export const SAFETY_REVIEW_OUTDATED_MESSAGE = "The safety approval is out of date.";
export const SAFETY_REVIEW_MISSING_MESSAGE = "No safety review has been raised yet.";

/**
 * One venue request on the event, as `answeredByReplacement` reads it. Times use the
 * `mode: "string"` shape, `YYYY-MM-DD HH:MM:SS`.
 */
export interface ConfirmationVenueRequest extends VenueRequestAnswerRow {
  venueName: string;
  startsAt: string;
  endsAt: string;
}

/**
 * PTR-138: Name a pending request by venue and window. Staff can still approve it, so the event
 * cannot be confirmed until the request is decided or withdrawn.
 */
export function pendingVenueRequestMessage(request: {
  venueName: string;
  startsAt: string;
  endsAt: string;
}): string {
  const period = formatVenuePeriod(request.startsAt, request.endsAt);
  return `The booking request for ${request.venueName} (${period}) is still pending.`;
}

/**
 * The blocker this row raises, or `null` when it raises none. Every status is named, so a sixth
 * status fails the type check.
 */
function outstandingVenueRequestMessage(request: ConfirmationVenueRequest): string | null {
  const period = formatVenuePeriod(request.startsAt, request.endsAt);
  switch (request.status) {
    case "pending":
      return pendingVenueRequestMessage(request);
    case "rejected":
      return `The booking request for ${request.venueName} (${period}) was rejected.`;
    case "released":
      return `The booking for ${request.venueName} (${period}) was released.`;
    case "approved":
    case "withdrawn":
      return null;
    default: {
      const unhandled: never = request.status;
      throw new Error(`Unhandled venue request status in confirmation gate: ${String(unhandled)}`);
    }
  }
}

export interface ConfirmationInput {
  status: EventRequestStatus;
  venueRequests: readonly ConfirmationVenueRequest[];
  /** PTR-137: true when a live venue block suspends the approved booking. */
  venueBookingSuspended?: boolean;
  equipmentLines: readonly { item: string; arrangementStatus: string }[];
  /** PTR-43's stamp: set when Technical Support marked every line arranged. */
  equipmentArrangementsCompletedAt: Date | null;
  safetyReview?: { state: SafetyReviewState; current: boolean } | null;
}

/**
 * Return every reason the event cannot be confirmed, or an empty list when it can. An
 * unconfirmable status is the only reason given: cancelled or completed events have no
 * outstanding arrangements.
 *
 * Otherwise each request that was not withdrawn must be approved or answered. A `rejected` or
 * `released` row is answered only through its chain of replacements: the last request in the chain
 * must be approved or pending, or the Coordinator must have dismissed the row (PTR-165). Name each
 * unanswered pending, rejected, or released booking, and each missing equipment arrangement. An
 * event with no equipment lines has nothing to settle, so the venue bookings alone govern (AC5).
 */
export function confirmationBlockers(input: ConfirmationInput): string[] {
  if (!isConfirmableStatus(input.status)) {
    return [`Its status is ${EVENT_REQUEST_STATUS_LABELS[input.status].toLowerCase()}.`];
  }

  const blockers = arrangementBlockers(input);
  const safetyBlocker = safetyReviewBlocker(input.safetyReview);
  if (safetyBlocker) blockers.push(safetyBlocker);
  return blockers;
}

/** Return arrangement blockers without the event's safety review. Used by the review sweep. */
export function arrangementBlockers(
  input: Pick<
    ConfirmationInput,
    | "venueRequests"
    | "venueBookingSuspended"
    | "equipmentLines"
    | "equipmentArrangementsCompletedAt"
  >
): string[] {
  const blockers: string[] = [];
  if (!input.venueRequests.some(request => request.status === "approved")) {
    blockers.push(VENUE_BOOKING_OUTSTANDING_MESSAGE);
  } else if (input.venueBookingSuspended) {
    blockers.push(VENUE_BOOKING_SUSPENDED_MESSAGE);
  }
  for (const request of input.venueRequests) {
    if (answeredByReplacement(request, input.venueRequests)) continue;
    const blocker = outstandingVenueRequestMessage(request);
    if (blocker) blockers.push(blocker);
  }
  const openLines = input.equipmentLines.filter(line => !isArrangedLine(line.arrangementStatus));
  for (const line of openLines) {
    blockers.push(
      `${line.item} is not arranged (${arrangementStateLabel(line.arrangementStatus).toLowerCase()}).`
    );
  }
  // All lines are arranged but completion was never marked (PTR-43). Name that, not a line.
  if (
    openLines.length === 0 &&
    !isEquipmentArrangementsSatisfied(input.equipmentLines, input.equipmentArrangementsCompletedAt)
  ) {
    blockers.push(EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE);
  }
  return blockers;
}

function safetyReviewBlocker(review: ConfirmationInput["safetyReview"]): string | null {
  if (!review) return SAFETY_REVIEW_MISSING_MESSAGE;
  switch (review.state) {
    case "approved":
      return review.current ? null : SAFETY_REVIEW_OUTDATED_MESSAGE;
    case "pending":
      return SAFETY_REVIEW_PENDING_MESSAGE;
    case "rejected":
      return SAFETY_REVIEW_REJECTED_MESSAGE;
    case "changes_requested":
      return SAFETY_REVIEW_CHANGES_REQUESTED_MESSAGE;
    default: {
      const unhandled: never = review.state;
      throw new Error(`Unhandled safety review state in confirmation gate: ${String(unhandled)}`);
    }
  }
}

/** Build the refusal message: a heading, then each reason on its own line. */
export function confirmationRefusalMessage(blockers: readonly string[]): string {
  return [CONFIRMATION_REFUSAL_HEADING, ...blockers.map(blocker => `- ${blocker}`)].join("\n");
}
