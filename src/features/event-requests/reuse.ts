import { eventTiming } from "#/features/events/access";
import { singaporeLocalEndHasPassed } from "#/features/events/completion";
import type { EventRequestStatus } from "#/features/event-requests/schema";

/**
 * PTR-154: whether a reuse is allowed. The list uses it to hide a button that would always be
 * refused, and the reuse handler uses it to refuse with 409. A completed request always
 * qualifies. Any other non-draft request qualifies only when its proposed end has passed in
 * Singapore time; a missing end never counts as passed.
 */
export function isReusableEventRequest(
  request: { status: EventRequestStatus; proposedDates: Array<{ start?: string; end?: string }> },
  now = new Date()
): boolean {
  if (request.status === "draft") return false;
  if (request.status === "completed") return true;
  const { endDate, endTime } = eventTiming(request.proposedDates);
  const eventEnd = endDate && endTime ? `${endDate}T${endTime}` : null;
  return singaporeLocalEndHasPassed(eventEnd, now) === true;
}
