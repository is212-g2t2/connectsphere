import type { EventRequestStatus } from "#/features/event-requests/schema";

export const REGISTRATION_NOT_OPEN_MESSAGE = "Registration is not open for this event.";
export const ALREADY_REGISTERED_MESSAGE = "You are already registered for this event.";
export const EVENT_FULL_MESSAGE = "This event is full.";
export const ALREADY_WAITLISTED_MESSAGE = "You are already on the waiting list for this event.";
export const NOT_WAITLISTED_MESSAGE = "You are not on the waiting list for this event.";
export const EVENT_NOT_FULL_MESSAGE =
  "This event still has places. Register instead of joining the waiting list.";
export const VIP_ALREADY_REGISTERED_MESSAGE = "This Attendee is already registered for this event.";
export const VIP_NOT_ATTENDEE_MESSAGE = "This Attendee account was not found.";
export const NOT_A_VIP_MESSAGE = "This Attendee holds no VIP registration for this event.";
export const VIPS_CLOSED_MESSAGE =
  "VIP registrations change only while the event is confirmed with registration on.";

/** PTR-45 AC5: Name the total ceiling. Use the same opening words as the AC3 refusal. */
export function venueCapacityReachedMessage(venueCapacity: number): string {
  return `${EVENT_FULL_MESSAGE} The total venue capacity of ${venueCapacity} is reached.`;
}

/**
 * Sum the capacities of the distinct venues with an approved booking. Count a venue once when
 * it holds bookings for separate sessions. Return null when no approved booking remains.
 */
export function totalVenueCapacity(
  bookings: readonly { venueId: number; venueCapacity: number }[]
): number | null {
  const seen = new Map<number, number>();
  for (const booking of bookings) {
    if (!seen.has(booking.venueId)) seen.set(booking.venueId, booking.venueCapacity);
  }
  if (seen.size === 0) return null;
  let total = 0;
  for (const capacity of seen.values()) total += capacity;
  return total;
}

/**
 * Limit normal registration to the lower of the event's registration capacity and the total
 * venue places left after VIPs. Read the total places from the approved bookings. VIPs take no
 * registration-capacity places (PTR-111 AC2).
 */
export function placeLimit(
  registrationCapacity: number,
  venueCapacity: number,
  vipCount: number
): number {
  return Math.min(registrationCapacity, Math.max(0, venueCapacity - vipCount));
}

/**
 * AC8 and AC9: Mark where the registered count stands. Tell the Organiser and the Coordinator at
 * the limit itself or at 90% of the limit, rounded up. Return null between the marks.
 */
export function placeMark(registered: number, limit: number): "full" | "nearly_full" | null {
  if (registered === limit) return "full";
  return registered === Math.ceil(limit * 0.9) ? "nearly_full" : null;
}

/** Terms of a published event. The handler refuses an unpublished event before this runs. */
interface RegistrationTerms {
  registrationCapacity: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** The venue's current wall-clock time in the stored `YYYY-MM-DDTHH:MM` spelling. */
  now: string;
  /** The event's normal `registered` registrations. A `withdrawn` registration holds no place (AC4). */
  registeredCount: number;
  /** The event's `registered` VIP registrations. They hold venue places only (PTR-111). */
  vipCount: number;
  /** The total venue capacity from the event's approved bookings. Null when the event has none. */
  venueCapacity: number | null;
}

interface RegistrationInput extends RegistrationTerms {
  /** Whether the Attendee already holds a `registered` registration (AC6). */
  alreadyRegistered: boolean;
}

/** Joining the waiting list also refuses an Attendee who already waits. */
interface WaitingListInput extends RegistrationTerms {
  alreadyRegistered: boolean;
  alreadyWaitlisted: boolean;
}

/** The places that decide a full-to-not-full transition. Waitlisted rows hold no place. */
export interface PlaceCounts {
  registeredCount: number;
  vipCount: number;
  venueCapacity: number | null;
  registrationCapacity: number | null;
}

/**
 * PTR-50: Tell an Attendee about registration before they try. `full` names the total venue
 * capacity when the venues set the limit (PTR-45 AC5), else null. `unavailable` covers an event
 * with no terms or no approved booking. The refusal answers those as not open.
 */
export type RegistrationAvailability =
  | { state: "open" }
  | { state: "not_yet_open" }
  | { state: "closed" }
  | { state: "full"; venueCapacity: number | null }
  | { state: "cancelled" }
  | { state: "unavailable" };

/**
 * The one rule for a new registration. Both `registrationRefusal` and `registrationAvailability`
 * read it. The window is half-open: it opens at the opening minute and closes at the closing
 * minute. Both sides use one fixed-width spelling, so they compare as strings. Check the period
 * before fullness. An unopened or closed period is the stable reason.
 */
function termsAvailability(
  terms: RegistrationTerms
): Exclude<RegistrationAvailability, { state: "cancelled" }> {
  const opens = terms.registrationOpensAt;
  const closes = terms.registrationClosesAt;
  const capacity = terms.registrationCapacity;
  if (opens === null || closes === null || capacity === null) return { state: "unavailable" };
  if (terms.now < opens) return { state: "not_yet_open" };
  if (terms.now >= closes) return { state: "closed" };

  // PTR-111: A confirmed event with no approved booking takes no new registrations. It has
  // no venue ceiling until an approved booking is recorded again.
  if (terms.venueCapacity === null) return { state: "unavailable" };
  // The total venue limit applies to every registration, including VIPs (PTR-45 AC5, PTR-111
  // AC3). Name the total when both limits are reached.
  if (terms.registeredCount + terms.vipCount >= terms.venueCapacity) {
    return { state: "full", venueCapacity: terms.venueCapacity };
  }
  if (terms.registeredCount >= capacity) return { state: "full", venueCapacity: null };
  return { state: "open" };
}

/** PTR-45 AC3 and AC5: Message for a full event. It names the total when the venues set the limit. */
export function eventFullMessage(venueCapacity: number | null): string {
  return venueCapacity === null ? EVENT_FULL_MESSAGE : venueCapacityReachedMessage(venueCapacity);
}

/** PTR-45: Reason to refuse this registration, or null when it may proceed. */
export function registrationRefusal(input: RegistrationInput): string | null {
  if (input.alreadyRegistered) return ALREADY_REGISTERED_MESSAGE;

  const availability = termsAvailability(input);
  switch (availability.state) {
    case "open":
      return null;
    case "full":
      return eventFullMessage(availability.venueCapacity);
    default:
      return REGISTRATION_NOT_OPEN_MESSAGE;
  }
}

/**
 * Whether the Attendee may join the waiting list. Join only a full event while its window is
 * open. A place left means registering instead. A closed window means the sweep already cleared
 * the list.
 */
export function waitingListJoinRefusal(input: WaitingListInput): string | null {
  if (input.alreadyRegistered) return ALREADY_REGISTERED_MESSAGE;
  if (input.alreadyWaitlisted) return ALREADY_WAITLISTED_MESSAGE;

  const availability = termsAvailability(input);
  switch (availability.state) {
    case "full":
      return null;
    case "open":
      return EVENT_NOT_FULL_MESSAGE;
    default:
      return REGISTRATION_NOT_OPEN_MESSAGE;
  }
}

/** Whether the counts stand at capacity. Null capacities mean unavailable, never full. */
function isFullPlaces(state: PlaceCounts): boolean {
  if (state.venueCapacity === null || state.registrationCapacity === null) return false;
  return (
    state.registeredCount + state.vipCount >= state.venueCapacity ||
    state.registeredCount >= state.registrationCapacity
  );
}

/**
 * Whether freeing places moved the event from full to not full. Notify each waitlisted Attendee
 * once when true. An unavailable after-state (no booking or no terms) is not a freed place.
 */
export function didFreePlace(before: PlaceCounts, after: PlaceCounts): boolean {
  if (after.venueCapacity === null || after.registrationCapacity === null) return false;
  return isFullPlaces(before) && !isFullPlaces(after);
}

/** The server's named waiting-list refusals. Other failures use the generic text. */
export function isWaitingListRefusal(message: string): boolean {
  return (
    message === REGISTRATION_NOT_OPEN_MESSAGE ||
    message === ALREADY_REGISTERED_MESSAGE ||
    message === ALREADY_WAITLISTED_MESSAGE ||
    message === EVENT_NOT_FULL_MESSAGE ||
    message === NOT_WAITLISTED_MESSAGE
  );
}

/**
 * PTR-50: Read the event's registration state from the same rule `registrationRefusal` uses. The
 * page then offers the action exactly when a new registration would proceed. Name a cancelled
 * event first (AC4). The handler refuses a cancelled event before the refusal runs, so the
 * refusal does not read the status.
 */
export function registrationAvailability(
  input: RegistrationTerms & { status: EventRequestStatus }
): RegistrationAvailability {
  return input.status === "cancelled" ? { state: "cancelled" } : termsAvailability(input);
}
