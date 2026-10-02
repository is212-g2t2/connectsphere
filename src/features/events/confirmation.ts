import { arrangementStateLabel } from "#/features/equipment-requests/schema";
import { isEquipmentArrangementsSatisfied } from "#/features/events/access";
import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";

/**
 * PTR-24 AC1/AC2: the stages an event can be confirmed from. `approved` is where a decision
 * leaves it; `planning` is the stage the brief names between approval and confirmation, kept
 * here so a later story that writes it does not have to widen the gate. Client-safe on purpose:
 * the Coordinator's card reads it to decide whether to offer the action.
 */
export const CONFIRMABLE_STATUSES = [
  "approved",
  "planning",
] as const satisfies readonly EventRequestStatus[];

export function isConfirmableStatus(status: EventRequestStatus): boolean {
  return CONFIRMABLE_STATUSES.some(confirmable => confirmable === status);
}

/** An equipment line is settled once it is reserved or Technical Support marked it not required. */
const SETTLED_ARRANGEMENT_STATES = new Set(["reserved", "not_required"]);

export const CONFIRMATION_REFUSAL_HEADING = "This event cannot be confirmed yet:";
export const VENUE_BOOKING_OUTSTANDING_MESSAGE = "There is no approved venue booking.";
export const EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE =
  "Technical Support has not marked the equipment arrangements complete.";

interface ConfirmationInput {
  status: EventRequestStatus;
  venueRequestStatuses: readonly string[];
  equipmentLines: readonly { item: string; arrangementStatus: string }[];
  /** PTR-43's stamp: set when Technical Support marked every line arranged. */
  equipmentArrangementsCompletedAt: Date | null;
}

/**
 * Every reason the event cannot be confirmed, or an empty list when it can. A status that cannot
 * be confirmed is the only reason given — the arrangements of a cancelled or completed event are
 * not outstanding. Otherwise each missing arrangement is its own entry, so a Coordinator learns
 * of all of them at once rather than fixing one and retrying (AC2). An event with no equipment
 * lines has nothing to settle, so the venue booking alone governs (AC5).
 */
export function confirmationBlockers(input: ConfirmationInput): string[] {
  if (!isConfirmableStatus(input.status)) {
    return [`Its status is ${EVENT_REQUEST_STATUS_LABELS[input.status].toLowerCase()}.`];
  }

  const blockers: string[] = [];
  if (!input.venueRequestStatuses.includes("approved")) {
    blockers.push(VENUE_BOOKING_OUTSTANDING_MESSAGE);
  }
  const openLines = input.equipmentLines.filter(
    line => !SETTLED_ARRANGEMENT_STATES.has(line.arrangementStatus)
  );
  for (const line of openLines) {
    blockers.push(
      `${line.item} is not arranged (${arrangementStateLabel(line.arrangementStatus).toLowerCase()}).`
    );
  }
  // Every line arranged but never marked complete (PTR-43): name that, not a line.
  if (
    openLines.length === 0 &&
    !isEquipmentArrangementsSatisfied(input.equipmentLines, input.equipmentArrangementsCompletedAt)
  ) {
    blockers.push(EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE);
  }
  return blockers;
}

/** The one message a refusal carries: a heading, then each reason on its own line. */
export function confirmationRefusalMessage(blockers: readonly string[]): string {
  return [CONFIRMATION_REFUSAL_HEADING, ...blockers.map(blocker => `- ${blocker}`)].join("\n");
}
