import { describe, expect, it } from "vitest";

import {
  ALREADY_REGISTERED_MESSAGE,
  ALREADY_WAITLISTED_MESSAGE,
  EVENT_NOT_FULL_MESSAGE,
  REGISTRATION_NOT_OPEN_MESSAGE,
  didFreePlace,
  isWaitingListRefusal,
  placeLimit,
  waitingListJoinRefusal,
} from "#/features/events/registration";

/** A full event with its window open: 40 of 40 places taken. */
const full = {
  registrationCapacity: 40,
  registrationOpensAt: "2026-11-01T09:00",
  registrationClosesAt: "2026-12-01T17:00",
  now: "2026-11-15T12:00",
  alreadyRegistered: false,
  alreadyWaitlisted: false,
  registeredCount: 40,
  vipCount: 0,
  venueCapacity: 60,
};

describe("waitingListJoinRefusal (PTR-163 AC1)", () => {
  it("lets an Attendee join when registrations fill the capacity with the window open", () => {
    expect(waitingListJoinRefusal(full)).toBeNull();
  });

  it("lets an Attendee join when registrations plus VIPs fill the total venue capacity", () => {
    expect(
      waitingListJoinRefusal({
        ...full,
        registrationCapacity: 100,
        registeredCount: 25,
        vipCount: 5,
        venueCapacity: 30,
      })
    ).toBeNull();
  });

  it("refuses outside the window, even when the event is full", () => {
    expect(waitingListJoinRefusal({ ...full, now: "2026-11-01T08:59" })).toBe(
      REGISTRATION_NOT_OPEN_MESSAGE
    );
    expect(waitingListJoinRefusal({ ...full, now: "2026-12-01T17:00" })).toBe(
      REGISTRATION_NOT_OPEN_MESSAGE
    );
    expect(isWaitingListRefusal(REGISTRATION_NOT_OPEN_MESSAGE)).toBe(true);
  });

  it("refuses when places remain, when already registered, or when already waiting", () => {
    expect(waitingListJoinRefusal({ ...full, registeredCount: 39 })).toBe(EVENT_NOT_FULL_MESSAGE);
    expect(waitingListJoinRefusal({ ...full, alreadyRegistered: true })).toBe(
      ALREADY_REGISTERED_MESSAGE
    );
    expect(waitingListJoinRefusal({ ...full, alreadyWaitlisted: true })).toBe(
      ALREADY_WAITLISTED_MESSAGE
    );
    expect(isWaitingListRefusal(EVENT_NOT_FULL_MESSAGE)).toBe(true);
    expect(isWaitingListRefusal(ALREADY_WAITLISTED_MESSAGE)).toBe(true);
  });
});

describe("didFreePlace (PTR-163 AC2)", () => {
  const before = {
    registeredCount: 40,
    vipCount: 0,
    venueCapacity: 60,
    registrationCapacity: 40,
  };

  it("fires once for a full-to-not-full transition", () => {
    expect(didFreePlace(before, { ...before, registeredCount: 39 })).toBe(true);
  });

  it("stays quiet while full and while already open", () => {
    // Still full: no transition, no second notice.
    expect(didFreePlace(before, before)).toBe(false);
    // Already open: a further withdrawal is no transition.
    const open = { ...before, registeredCount: 39 };
    expect(didFreePlace(open, { ...open, registeredCount: 38 })).toBe(false);
  });

  it("fires when a VIP removal opens a venue place", () => {
    const venueFull = {
      registeredCount: 25,
      vipCount: 5,
      venueCapacity: 30,
      registrationCapacity: 100,
    };
    expect(didFreePlace(venueFull, { ...venueFull, vipCount: 4 })).toBe(true);
  });

  it("treats a lost booking or lost terms as unavailable, never as a freed place", () => {
    expect(didFreePlace(before, { ...before, registeredCount: 39, venueCapacity: null })).toBe(
      false
    );
    expect(
      didFreePlace(before, { ...before, registeredCount: 39, registrationCapacity: null })
    ).toBe(false);
  });
});

describe("capacity recomputation on withdrawal (PTR-163 AC2)", () => {
  it("drops the registered count below the place limit, so the transition fires", () => {
    const limit = placeLimit(40, 60, 0);
    expect(40 >= limit).toBe(true);
    expect(39 < limit).toBe(true);
    expect(
      didFreePlace(
        { registeredCount: 40, vipCount: 0, venueCapacity: 60, registrationCapacity: 40 },
        { registeredCount: 39, vipCount: 0, venueCapacity: 60, registrationCapacity: 40 }
      )
    ).toBe(true);
  });

  it("raises the normal place limit when a VIP leaves, so a waiting list can open", () => {
    expect(placeLimit(40, 30, 4)).toBeGreaterThan(placeLimit(40, 30, 5));
  });
});
