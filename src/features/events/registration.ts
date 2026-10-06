import type { EventRequestStatus } from "#/features/event-requests/schema";

export const REGISTRATION_NOT_OPEN_MESSAGE = "Registration is not open for this event.";
export const ALREADY_REGISTERED_MESSAGE = "You are already registered for this event.";
export const EVENT_FULL_MESSAGE = "This event is full.";
export const VIP_ALREADY_REGISTERED_MESSAGE = "This Attendee is already registered for this event.";
export const VIP_NOT_ATTENDEE_MESSAGE = "This Attendee account was not found.";
export const NOT_A_VIP_MESSAGE = "This Attendee holds no VIP registration for this event.";
export const VIPS_CLOSED_MESSAGE =
  "VIP registrations change only while the event is confirmed with registration on.";

/** PTR-45 AC5: the venue's ceiling is named, after the same opening words as AC3's refusal. */
export function venueCapacityReachedMessage(venueCapacity: number): string {
  return `${EVENT_FULL_MESSAGE} The venue capacity of ${venueCapacity} is reached.`;
}

/**
 * The places normal registration may fill: the lower of the event's registration capacity and
 * the venue places that the VIPs leave, on the event's approved booking (second clarification:
 * registration is governed by the overall venue/event capacity). VIPs take no place in the
 * registration capacity (PTR-111 AC2).
 */
export function placeLimit(
  registrationCapacity: number,
  venueCapacity: number,
  vipCount: number
): number {
  return Math.min(registrationCapacity, Math.max(0, venueCapacity - vipCount));
}

/**
 * AC8 and AC9: the mark that a registered count stands on, which the Organiser and the Coordinator
 * are told of: the limit itself, or 90% of it rounded up. Null between the marks.
 */
export function placeMark(registered: number, limit: number): "full" | "nearly_full" | null {
  if (registered === limit) return "full";
  return registered === Math.ceil(limit * 0.9) ? "nearly_full" : null;
}

/** The terms of a published event; the handler refuses an unpublished one before this runs. */
interface RegistrationTerms {
  registrationCapacity: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** The venue's wall clock now, in the stored `YYYY-MM-DDTHH:MM` spelling. */
  now: string;
  /** The event's normal `registered` registrations only: a `withdrawn` one holds no place (AC4). */
  registeredCount: number;
  /** The event's `registered` VIP registrations, which hold venue places only (PTR-111). */
  vipCount: number;
  /** The capacity of the venue on the event's approved booking, or null when it has none. */
  venueCapacity: number | null;
}

interface RegistrationInput extends RegistrationTerms {
  /** Whether the Attendee already holds a `registered` registration for the event (AC6). */
  alreadyRegistered: boolean;
}

/**
 * PTR-50: what an Attendee is told about registering before they try. `full` names the venue
 * capacity when the venue is the limit (PTR-45 AC5), else null. `unavailable` covers an event with
 * no terms or no approved booking, which the refusal answers as not open.
 */
export type RegistrationAvailability =
  | { state: "open" }
  | { state: "not_yet_open" }
  | { state: "closed" }
  | { state: "full"; venueCapacity: number | null }
  | { state: "cancelled" }
  | { state: "unavailable" };

/**
 * The one rule for a new registration, which `registrationRefusal` and `registrationAvailability`
 * both read. The window is half-open: it opens at the opening minute and closes at the closing
 * minute. Both sides use one fixed-width spelling, so they compare as strings. A period that has
 * not opened or has closed comes before a full event, because it is the reason that does not
 * change.
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

  // PTR-111 note: a confirmed event whose booking was released takes no new registrations until
  // an approved booking is recorded again, because there is no venue ceiling to hold them to.
  if (terms.venueCapacity === null) return { state: "unavailable" };
  // The venue is the ceiling for every registration, VIPs included (PTR-45 AC5, PTR-111 AC3), so
  // it is named when both limits are reached.
  if (terms.registeredCount + terms.vipCount >= terms.venueCapacity) {
    return { state: "full", venueCapacity: terms.venueCapacity };
  }
  if (terms.registeredCount >= capacity) return { state: "full", venueCapacity: null };
  return { state: "open" };
}

/** PTR-45 AC3 and AC5: the sentence for a full event, which names the venue when it is the limit. */
export function eventFullMessage(venueCapacity: number | null): string {
  return venueCapacity === null ? EVENT_FULL_MESSAGE : venueCapacityReachedMessage(venueCapacity);
}

/** PTR-45: why this registration is refused, or null when it may proceed. */
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
 * PTR-50: the event's registration state, from the rule `registrationRefusal` applies, so the
 * page offers the action exactly when a new registration would proceed. A cancelled event says so
 * first (AC4). The handler refuses a cancelled event before the refusal runs, so the refusal
 * itself does not read the status.
 */
export function registrationAvailability(
  input: RegistrationTerms & { status: EventRequestStatus }
): RegistrationAvailability {
  return input.status === "cancelled" ? { state: "cancelled" } : termsAvailability(input);
}
