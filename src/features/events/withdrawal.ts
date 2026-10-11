/**
 * PTR-47: Pure withdrawal rules. This module has no server-only imports, so client-reachable
 * modules can import it.
 */

import { CANCELLED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/cancellation";
import { COMPLETED_EVENT_ACTIVITY_MESSAGE } from "#/features/events/completion";

export const NOT_REGISTERED_MESSAGE = "You do not hold an active registration for this event.";
export const PLACE_FREED_MESSAGE = "Your place has been freed.";

/** AC4: Message for a place freed while the event was at capacity. */
export const PLACE_FREED_AT_CAPACITY_MESSAGE =
  "Your place has been freed. The Organiser has been notified.";

/** The server's named withdrawal refusals. Other failures use the generic text. */
export function isWithdrawalRefusal(message: string): boolean {
  return (
    message === NOT_REGISTERED_MESSAGE ||
    message === CANCELLED_EVENT_ACTIVITY_MESSAGE ||
    message === COMPLETED_EVENT_ACTIVITY_MESSAGE
  );
}
