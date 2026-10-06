import { EVENT_REQUEST_STATUS_LABELS } from "#/features/event-requests/schema";
import type { EventRequestStatus } from "#/features/event-requests/schema";
import { ConflictError } from "#/features/auth/session";
import { eventTiming } from "#/features/events/access";

export const COMPLETION_REFUSAL_HEADING = "This event cannot be completed:";
export const NO_EVENT_END_MESSAGE = "The event does not have an end date and time.";
export const EVENT_HAS_NOT_ENDED_MESSAGE = "The event end date and time has not passed.";
export const COMPLETED_EVENT_ACTIVITY_MESSAGE =
  "Completed events cannot accept new venue bookings, equipment reservations, or registrations.";

/**
 * The completed-event refusal every activity write path shares: venue approvals and
 * equipment reservations read the event under lock, then call this after their
 * ownership gate, so a refused probe reveals nothing about an event the caller
 * cannot work. A null status is not a bypass: the callers hold the event row
 * through the non-null FK, and a missing row fails their write on that FK.
 */
export function assertEventAcceptsActivity(status: string | null | undefined): void {
  if (status === "completed") throw new ConflictError(COMPLETED_EVENT_ACTIVITY_MESSAGE);
}

interface CompletionInput {
  status: EventRequestStatus;
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
  if (input.eventHasEnded === null) return NO_EVENT_END_MESSAGE;
  return input.eventHasEnded ? null : EVENT_HAS_NOT_ENDED_MESSAGE;
}

/** The completion refusal for an event record, read from its own proposed end. */
export function completionRefusalForEvent(
  record: { status: EventRequestStatus; proposedDates: Array<{ start?: string; end?: string }> },
  now = new Date()
): string | null {
  const { endDate, endTime } = eventTiming(record.proposedDates);
  const eventEnd = endDate && endTime ? `${endDate}T${endTime}` : null;
  return completionRefusal({
    status: record.status,
    eventHasEnded: singaporeLocalEndHasPassed(eventEnd, now),
  });
}
