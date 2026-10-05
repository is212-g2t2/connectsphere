import { describe, expect, it } from "vitest";

import {
  ALREADY_REGISTERED_MESSAGE,
  EVENT_FULL_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  crossesPlaceThreshold,
  placeLimit,
  registrationRefusal,
  venueCapacityReachedMessage,
} from "#/features/events/registration";

/** A published event, open from 1 Nov 09:00 to 1 Dec 17:00, with places left. */
const open = {
  registrationCapacity: 40,
  registrationOpensAt: "2026-11-01T09:00",
  registrationClosesAt: "2026-12-01T17:00",
  now: "2026-11-15T12:00",
  alreadyRegistered: false,
  registeredCount: 10,
  vipCount: 0,
  venueCapacity: 60,
};

describe("registrationRefusal (PTR-45)", () => {
  it("lets a registration proceed inside the period with places left (AC2)", () => {
    expect(registrationRefusal(open)).toBeNull();
  });

  it("opens at the opening minute and closes at the closing minute (AC2)", () => {
    expect(registrationRefusal({ ...open, now: "2026-11-01T08:59" })).toBe(
      REGISTRATION_NOT_OPEN_MESSAGE
    );
    expect(registrationRefusal({ ...open, now: "2026-11-01T09:00" })).toBeNull();
    expect(registrationRefusal({ ...open, now: "2026-12-01T16:59" })).toBeNull();
    expect(registrationRefusal({ ...open, now: "2026-12-01T17:00" })).toBe(
      REGISTRATION_NOT_OPEN_MESSAGE
    );
  });

  it("says the event is full at its registration capacity (AC3)", () => {
    expect(registrationRefusal({ ...open, registeredCount: 39 })).toBeNull();
    expect(registrationRefusal({ ...open, registeredCount: 40 })).toBe(EVENT_FULL_MESSAGE);
  });

  it("names the venue capacity when registrations fill the venue (AC5)", () => {
    const smallVenue = { ...open, venueCapacity: 25 };

    expect(registrationRefusal({ ...smallVenue, registeredCount: 24 })).toBeNull();
    expect(registrationRefusal({ ...smallVenue, registeredCount: 25 })).toBe(
      venueCapacityReachedMessage(25)
    );
    expect(venueCapacityReachedMessage(25)).toBe(
      "This event is full. The venue capacity of 25 is reached."
    );
  });

  it("names the venue when both limits are reached together", () => {
    expect(registrationRefusal({ ...open, venueCapacity: 40, registeredCount: 40 })).toBe(
      venueCapacityReachedMessage(40)
    );
  });

  it("counts the VIPs against the venue and names it, but not against the capacity (PTR-111)", () => {
    const withVips = { ...open, venueCapacity: 45, vipCount: 5 };

    expect(registrationRefusal({ ...withVips, registeredCount: 39 })).toBeNull();
    expect(registrationRefusal({ ...withVips, registeredCount: 40 })).toBe(
      venueCapacityReachedMessage(45)
    );
    // Room at the venue, so the registration capacity alone stops it.
    expect(registrationRefusal({ ...open, vipCount: 5, registeredCount: 40 })).toBe(
      EVENT_FULL_MESSAGE
    );
  });

  it("refuses a confirmed event whose approved booking is gone", () => {
    expect(registrationRefusal({ ...open, venueCapacity: null })).toBe(
      REGISTRATION_NOT_OPEN_MESSAGE
    );
  });

  it("refuses a second registration, before any other reason (AC6)", () => {
    expect(registrationRefusal({ ...open, alreadyRegistered: true })).toBe(
      ALREADY_REGISTERED_MESSAGE
    );
    expect(registrationRefusal({ ...open, alreadyRegistered: true, registeredCount: 40 })).toBe(
      ALREADY_REGISTERED_MESSAGE
    );
  });
});

describe("crossesPlaceThreshold (PTR-45 AC8, AC9)", () => {
  it("tells at 90% of the limit, rounded up, and at the limit, and nowhere else", () => {
    const told = Array.from({ length: 40 }, (_, index) => index + 1).filter(registered =>
      crossesPlaceThreshold(registered, 40)
    );

    expect(told).toEqual([36, 40]);
  });

  it("rounds 90% up, and tells once at the limit when that is where it lands", () => {
    // 90% of 11 is 9.9, so the tenth registration; 90% of 6 is 5.4, which rounds up to the limit.
    expect(crossesPlaceThreshold(10, 11)).toBe(true);
    expect(crossesPlaceThreshold(5, 6)).toBe(false);
    expect(crossesPlaceThreshold(6, 6)).toBe(true);
  });
});

describe("placeLimit (PTR-45, PTR-111)", () => {
  it("is the lower of the capacity and the venue places the VIPs leave", () => {
    expect(placeLimit(40, 60, 0)).toBe(40);
    expect(placeLimit(40, 60, 25)).toBe(35);
    expect(placeLimit(40, 30, 0)).toBe(30);
  });

  it("is never below zero, even when a smaller venue now holds fewer than the VIPs", () => {
    expect(placeLimit(40, 10, 12)).toBe(0);
  });
});
