/**
 * PTR-47: pure withdrawal rules — no server imports, so client-reachable modules may import this.
 */

export const NOT_REGISTERED_MESSAGE = "You do not hold an active registration for this event.";
export const PLACE_FREED_MESSAGE = "Your place has been freed.";

/** AC4: the sentence for a freed place where the event was at capacity when the withdrawal runs. */
export const PLACE_FREED_AT_CAPACITY_MESSAGE =
  "Your place has been freed. The Organiser and Coordinator have been notified.";
