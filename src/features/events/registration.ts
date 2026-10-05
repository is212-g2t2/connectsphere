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
interface RegistrationInput {
  registrationCapacity: number | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** The venue's wall clock now, in the stored `YYYY-MM-DDTHH:MM` spelling. */
  now: string;
  /** Whether the Attendee already holds a `registered` registration for the event (AC6). */
  alreadyRegistered: boolean;
  /** The event's normal `registered` registrations only: a `withdrawn` one holds no place (AC4). */
  registeredCount: number;
  /** The event's `registered` VIP registrations, which hold venue places only (PTR-111). */
  vipCount: number;
  /** The capacity of the venue on the event's approved booking, or null when it has none. */
  venueCapacity: number | null;
}

/**
 * PTR-45: why this registration is refused, or null when it may proceed. The window is half-open:
 * it opens at the opening minute and closes at the closing minute. Both sides use one fixed-width
 * spelling, so they compare as strings.
 */
export function registrationRefusal(input: RegistrationInput): string | null {
  if (input.alreadyRegistered) return ALREADY_REGISTERED_MESSAGE;

  const opens = input.registrationOpensAt;
  const closes = input.registrationClosesAt;
  const capacity = input.registrationCapacity;
  if (
    opens === null ||
    closes === null ||
    capacity === null ||
    input.now < opens ||
    input.now >= closes
  ) {
    return REGISTRATION_NOT_OPEN_MESSAGE;
  }

  // PTR-111 note: a confirmed event whose booking was released takes no new registrations until
  // an approved booking is recorded again, because there is no venue ceiling to hold them to.
  if (input.venueCapacity === null) return REGISTRATION_NOT_OPEN_MESSAGE;
  // The venue is the ceiling for every registration, VIPs included (PTR-45 AC5, PTR-111 AC3), so
  // it is named when both limits are reached.
  if (input.registeredCount + input.vipCount >= input.venueCapacity) {
    return venueCapacityReachedMessage(input.venueCapacity);
  }
  if (input.registeredCount >= capacity) return EVENT_FULL_MESSAGE;
  return null;
}

/**
 * PTR-50: what an Attendee is told about registering before they try. `unavailable` covers an
 * event with no terms or no approved booking, which the refusal above answers as not open.
 */
export type RegistrationAvailability =
  | { state: "open" }
  | { state: "not_yet_open"; opensAt: string }
  | { state: "closed" }
  | { state: "full" }
  | { state: "cancelled" }
  | { state: "unavailable" };

/**
 * PTR-50: the event's registration state, derived from the same rule `registrationRefusal`
 * applies, so the page offers the action exactly when a new registration would proceed. A
 * cancelled event says so first (AC4); a period that has not opened or has closed is named before
 * a full event, because it is the reason that does not change.
 */
export function registrationAvailability(
  input: Omit<RegistrationInput, "alreadyRegistered"> & { status: EventRequestStatus }
): RegistrationAvailability {
  if (input.status === "cancelled") return { state: "cancelled" };
  if (input.registrationOpensAt !== null && input.now < input.registrationOpensAt) {
    return { state: "not_yet_open", opensAt: input.registrationOpensAt };
  }
  if (input.registrationClosesAt !== null && input.now >= input.registrationClosesAt) {
    return { state: "closed" };
  }
  const refusal = registrationRefusal({ ...input, alreadyRegistered: false });
  if (refusal === null) return { state: "open" };
  return refusal.startsWith(EVENT_FULL_MESSAGE) ? { state: "full" } : { state: "unavailable" };
}
