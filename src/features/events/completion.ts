import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";

export const COMPLETION_REFUSAL_HEADING = "This event cannot be completed:";
export const NO_EVENT_END_MESSAGE = "The event does not have an end date and time.";
export const EVENT_HAS_NOT_ENDED_MESSAGE = "The event end date and time has not passed.";
export const COMPLETED_EVENT_ACTIVITY_MESSAGE =
  "Completed events cannot accept new venue bookings, equipment reservations, or registrations.";

interface CompletionInput {
  status: EventRequestStatus;
  approvedBookingHasEnded: boolean | null;
  eventHasEnded: boolean | null;
}

/** Compare a timestamp without a time zone as Singapore wall-clock time. */
export function singaporeLocalEndHasPassed(value: string | null, now = new Date()): boolean | null {
  if (value === null) return null;
  const localTimestamp = value.replace(" ", "T");
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTimestamp)
    ? `${localTimestamp}:00`
    : localTimestamp;
  const end = Date.parse(`${withSeconds}+08:00`);
  return Number.isNaN(end) ? null : end < now.getTime();
}

/** One refusal for the completion attempt, or null when it may proceed. */
export function completionRefusal(input: CompletionInput): string | null {
  if (input.status !== "confirmed") {
    return `Its status is ${EVENT_REQUEST_STATUS_LABELS[input.status].toLowerCase()}.`;
  }
  const hasEnded = input.approvedBookingHasEnded ?? input.eventHasEnded;
  if (hasEnded === null) return NO_EVENT_END_MESSAGE;
  return hasEnded ? null : EVENT_HAS_NOT_ENDED_MESSAGE;
}
