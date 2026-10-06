import { describe, expect, it } from "vitest";

import { isPublishedForAttendees } from "#/features/events/access";
import {
  ALREADY_REGISTERED_MESSAGE,
  EVENT_FULL_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  eventFullMessage,
  placeMark,
  placeLimit,
  registrationAvailability,
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

describe("placeMark (PTR-45 AC8, AC9)", () => {
  it("stands at 90% of the limit, rounded up, and at the limit, and nowhere else", () => {
    const marks = Array.from({ length: 40 }, (_, index) => index + 1).flatMap(registered => {
      const mark = placeMark(registered, 40);
      return mark ? [[registered, mark]] : [];
    });

    expect(marks).toEqual([
      [36, "nearly_full"],
      [40, "full"],
    ]);
  });

  it("rounds 90% up, and is full when that is where it lands", () => {
    // 90% of 11 is 9.9, so the tenth registration; 90% of 6 is 5.4, which rounds up to the limit.
    expect(placeMark(10, 11)).toBe("nearly_full");
    expect(placeMark(5, 6)).toBeNull();
    expect(placeMark(6, 6)).toBe("full");
  });

  it("tells the two marks apart where a lower limit moves the count from one to the other", () => {
    // PTR-111: a VIP takes a limit of 10 down to 9 with 9 normal registrations.
    expect(placeMark(9, 10)).toBe("nearly_full");
    expect(placeMark(9, 9)).toBe("full");
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

describe("registrationAvailability (PTR-50)", () => {
  const confirmed = { ...open, status: "confirmed" as const };

  it("is open inside the period with places left", () => {
    expect(registrationAvailability(confirmed)).toEqual({ state: "open" });
  });

  it("is not yet open before the opening minute (AC1)", () => {
    expect(registrationAvailability({ ...confirmed, now: "2026-11-01T08:59" })).toEqual({
      state: "not_yet_open",
    });
    expect(registrationAvailability({ ...confirmed, now: "2026-11-01T09:00" })).toEqual({
      state: "open",
    });
  });

  it("is closed from the closing minute on (AC2)", () => {
    expect(registrationAvailability({ ...confirmed, now: "2026-12-01T17:00" })).toEqual({
      state: "closed",
    });
  });

  it("is full at the registration capacity (AC3)", () => {
    expect(registrationAvailability({ ...confirmed, registeredCount: 40 })).toEqual({
      state: "full",
      venueCapacity: null,
    });
  });

  it("is full when normal and VIP registrations together fill the venue, and names it (AC3)", () => {
    expect(
      registrationAvailability({
        ...confirmed,
        venueCapacity: 30,
        registeredCount: 25,
        vipCount: 5,
      })
    ).toEqual({ state: "full", venueCapacity: 30 });
  });

  it("states the closed period before a full event, as the period is the plainer reason", () => {
    expect(
      registrationAvailability({ ...confirmed, now: "2026-12-02T09:00", registeredCount: 40 })
    ).toEqual({ state: "closed" });
  });

  it("is cancelled for a cancelled event, whatever the period or the places (AC4)", () => {
    expect(registrationAvailability({ ...confirmed, status: "cancelled" })).toEqual({
      state: "cancelled",
    });
    expect(
      registrationAvailability({ ...confirmed, status: "cancelled", now: "2026-10-01T09:00" })
    ).toEqual({ state: "cancelled" });
  });

  it("is unavailable while the event has no terms or no approved booking", () => {
    expect(
      registrationAvailability({
        ...confirmed,
        registrationCapacity: null,
        registrationOpensAt: null,
        registrationClosesAt: null,
      })
    ).toEqual({ state: "unavailable" });
    expect(registrationAvailability({ ...confirmed, venueCapacity: null })).toEqual({
      state: "unavailable",
    });
  });

  it("agrees with the server: open exactly when a new registration would proceed", () => {
    const cancelled = { ...confirmed, status: "cancelled" as const };
    const cases = [
      confirmed,
      { ...confirmed, now: "2026-11-01T08:59" },
      { ...confirmed, now: "2026-12-01T17:00" },
      { ...confirmed, registeredCount: 40 },
      { ...confirmed, venueCapacity: 10 },
      { ...confirmed, venueCapacity: null },
      { ...confirmed, registrationCapacity: null },
      cancelled,
      { ...cancelled, now: "2026-11-01T08:59" },
    ];
    for (const input of cases) {
      // The handler refuses an unpublished event, a cancelled one included, before the refusal
      // runs (PTR-45 AC2). The refusal alone lets the cancelled cases through.
      const proceeds =
        isPublishedForAttendees({ ...input, registrationEnabled: true }) &&
        registrationRefusal(input) === null;
      expect(registrationAvailability(input).state === "open").toBe(proceeds);
    }
  });

  it("words a full event as the refusal does, and names the venue when it is the limit", () => {
    expect(eventFullMessage(null)).toBe(registrationRefusal({ ...open, registeredCount: 40 }));
    expect(eventFullMessage(30)).toBe(
      registrationRefusal({ ...open, venueCapacity: 30, registeredCount: 25, vipCount: 5 })
    );
  });
});
