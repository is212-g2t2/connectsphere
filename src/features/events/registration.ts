export const REGISTRATION_NOT_OPEN_MESSAGE = "Registration is not open for this event.";
export const ALREADY_REGISTERED_MESSAGE = "You are already registered for this event.";
export const EVENT_FULL_MESSAGE = "This event is full.";
export const VIP_ALREADY_REGISTERED_MESSAGE = "This Attendee is already registered for this event.";
export const VIP_NOT_ATTENDEE_MESSAGE = "No Attendee account uses this email.";
export const VIP_ALREADY_REMOVED_MESSAGE = "This VIP registration was already removed.";

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
 * AC8 and AC9: whether a registration that brings the registered count to `registered` tells the
 * Organiser and the Coordinator. That is so at the limit, and at 90% of it rounded up.
 */
export function crossesPlaceThreshold(registered: number, limit: number): boolean {
  return registered === limit || registered === Math.ceil(limit * 0.9);
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
  // The venue is the ceiling for every registration, VIPs included (AC5), so it is named when
  // both limits are reached.
  if (input.registeredCount + input.vipCount >= input.venueCapacity) {
    return venueCapacityReachedMessage(input.venueCapacity);
  }
  if (input.registeredCount >= capacity) return EVENT_FULL_MESSAGE;
  return null;
}

/**
 * PTR-111: why a VIP registration is refused, or null when it may proceed. A VIP skips the
 * registration period and capacity, so the venue on the approved booking is the only ceiling
 * (AC2, AC3). No approved booking means no ceiling, so it is refused like a normal registration.
 */
export function vipRegistrationRefusal(input: {
  alreadyRegistered: boolean;
  registeredCount: number;
  vipCount: number;
  venueCapacity: number | null;
}): string | null {
  if (input.alreadyRegistered) return VIP_ALREADY_REGISTERED_MESSAGE;
  if (input.venueCapacity === null) return REGISTRATION_NOT_OPEN_MESSAGE;
  if (input.registeredCount + input.vipCount >= input.venueCapacity) {
    return venueCapacityReachedMessage(input.venueCapacity);
  }
  return null;
}
