import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import { isArrangedLine, isEquipmentArrangementsSatisfied } from "#/features/events/access";
import { formatVenuePeriod } from "#/features/event-requests/format";
import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { VenueRequestStatus } from "#/features/venue-requests/schema";

/**
 * PTR-24 AC1/AC2: List the stages an event can be confirmed from. `approved` is where a decision
 * leaves the request. `planning` is the stage between approval and confirmation. Keep it here so
 * a later story that writes it need not widen the gate.
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
export const MULTIPLE_VENUE_BOOKINGS_MESSAGE = "There is more than one approved venue booking.";
export const EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE =
  "Technical Support has not marked the equipment arrangements complete.";

/** One venue request on the event. Times use the `mode: "string"` shape, `YYYY-MM-DD HH:MM:SS`. */
interface ConfirmationVenueRequest {
  status: VenueRequestStatus;
  venueName: string;
  startsAt: string;
  endsAt: string;
}

/**
 * PTR-138: Name a pending request by venue and window. Staff can still approve it, so the event
 * cannot be confirmed until the request is decided or withdrawn.
 */
export function pendingVenueRequestMessage(request: Omit<ConfirmationVenueRequest, "status">) {
  const period = formatVenuePeriod(request.startsAt, request.endsAt);
  return `The booking request for ${request.venueName} (${period}) is still pending.`;
}

interface ConfirmationInput {
  status: EventRequestStatus;
  venueRequests: readonly ConfirmationVenueRequest[];
  equipmentLines: readonly { item: string; arrangementStatus: string }[];
  /** PTR-43's stamp: set when Technical Support marked every line arranged. */
  equipmentArrangementsCompletedAt: Date | null;
}

/**
 * Return every reason the event cannot be confirmed, or an empty list when it can. An
 * unconfirmable status is the only reason given: cancelled or completed events have no
 * outstanding arrangements.
 *
 * Otherwise the gate needs exactly one approved venue booking and no pending venue request. Each
 * pending request and each missing arrangement is its own entry (AC2). An event with no equipment
 * lines has nothing to settle, so the venue booking alone governs (AC5).
 */
export function confirmationBlockers(input: ConfirmationInput): string[] {
  if (!isConfirmableStatus(input.status)) {
    return [`Its status is ${EVENT_REQUEST_STATUS_LABELS[input.status].toLowerCase()}.`];
  }

  const blockers: string[] = [];
  const approvedBookings = input.venueRequests.filter(request => request.status === "approved");
  if (approvedBookings.length === 0) {
    blockers.push(VENUE_BOOKING_OUTSTANDING_MESSAGE);
  } else if (approvedBookings.length > 1) {
    blockers.push(MULTIPLE_VENUE_BOOKINGS_MESSAGE);
  }
  for (const request of input.venueRequests) {
    if (request.status === "pending") blockers.push(pendingVenueRequestMessage(request));
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

/** Build the refusal message: a heading, then each reason on its own line. */
export function confirmationRefusalMessage(blockers: readonly string[]): string {
  return [CONFIRMATION_REFUSAL_HEADING, ...blockers.map(blocker => `- ${blocker}`)].join("\n");
}
