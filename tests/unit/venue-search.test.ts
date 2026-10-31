import { describe, expect, it } from "vitest";

import {
  evaluateVenueSuitability,
  requirementFailures,
  resolveSearchLayout,
  shiftedDayTime,
  windowAvailabilityFailure,
} from "#/features/venues/records.server";
import type { SuitabilityCriterion } from "#/features/venues/records.server";
import {
  AVAILABILITY_RANGE_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  INITIAL_ROOM_LAYOUTS,
  LAYOUT_MESSAGE,
  VENUE_SEARCH_TIME_MESSAGE,
  assertKnownLayoutText,
  parseVenueSearchRequest,
} from "#/features/venues/schema";
import type { OperatingHours } from "#/features/venues/schema";

const venue = {
  id: 7,
  name: "Great Hall",
  location: "Level 2, East Wing",
  maxCapacity: 200,
  facilities: ["Projector", "PA system"],
  accessibilityFeatures: ["Step-free access", "Hearing loop"],
  supportedLayouts: ["theatre", "banquet"] as const,
  operatingHours: DEFAULT_OPERATING_HOURS,
};

const filters = {
  date: "2026-10-05",
  startTime: "10:00",
  endTime: "12:00",
  expectedAttendance: 120,
  capacity: 150,
  location: "east wing",
  accessibility: "Step-free access, hearing loop",
  layout: "Theatre seating",
  facilities: "projector, PA system",
};

describe("PTR-29 venue-search input", () => {
  it("accepts every story filter from URL-shaped strings", () => {
    expect(
      parseVenueSearchRequest({
        eventId: "41",
        date: "2026-10-05",
        startTime: "10:00",
        endTime: "12:00",
        expectedAttendance: "120",
        capacity: "150",
        location: "  East Wing  ",
        accessibility: "Step-free access, hearing loop",
        layout: "theatre",
        facilities: "Projector, PA system",
      })
    ).toEqual({
      eventId: 41,
      date: "2026-10-05",
      startTime: "10:00",
      endTime: "12:00",
      expectedAttendance: 120,
      capacity: 150,
      location: "East Wing",
      accessibility: "Step-free access, hearing loop",
      layout: "theatre",
      facilities: "Projector, PA system",
    });
  });

  it.each([
    [{ date: "2026-10-05", startTime: "10:00" }, VENUE_SEARCH_TIME_MESSAGE],
    [{ startTime: "10:00", endTime: "12:00" }, "Choose a date when filtering by time"],
    [
      { date: "2026-10-05", startTime: "12:00", endTime: "10:00" },
      "End time must be later than start time",
    ],
  ])("refuses an incomplete or invalid time filter: %j", (input, message) => {
    expect(() => parseVenueSearchRequest(input)).toThrow(message);
  });

  it("accepts a cross-day period when its end date makes the end later than the start", () => {
    expect(
      parseVenueSearchRequest({
        date: "2026-10-05",
        endDate: "2026-10-06",
        startTime: "22:00",
        endTime: "02:00",
      })
    ).toMatchObject({
      date: "2026-10-05",
      endDate: "2026-10-06",
      startTime: "22:00",
      endTime: "02:00",
    });
  });

  it("refuses a date range longer than the availability projection supports", () => {
    expect(() => parseVenueSearchRequest({ date: "2026-01-01", endDate: "2027-01-02" })).toThrow(
      AVAILABILITY_RANGE_MESSAGE
    );
  });
});

type Evaluate = Parameters<typeof evaluateVenueSuitability>;

/** PTR-29 returned a yes/no verdict. PTR-30 added reasons. Search is allowed without bookings. */
function suits(
  candidate: Evaluate[0],
  search: Evaluate[1],
  blocks: Evaluate[2],
  bookings: Evaluate[3] = [],
  holds: Evaluate[4] = []
) {
  return evaluateVenueSuitability(candidate, search, blocks, bookings, holds).suitable;
}

describe("PTR-29 suitability rules", () => {
  it("accepts a venue only when every applied filter passes", () => {
    expect(suits(venue, filters, [])).toBe(true);
  });

  it.each([
    ["expected attendance", { ...venue, maxCapacity: 119 }, filters],
    ["capacity", venue, { ...filters, expectedAttendance: undefined, capacity: 201 }],
    ["location", { ...venue, location: "West Wing" }, filters],
    ["accessibility", { ...venue, accessibilityFeatures: ["Step-free access"] }, filters],
    ["layout", { ...venue, supportedLayouts: ["banquet"] as const }, filters],
    ["facilities", { ...venue, facilities: ["Projector"] }, filters],
    [
      "operating hours",
      {
        ...venue,
        operatingHours: { ...DEFAULT_OPERATING_HOURS, mon: { opens: "13:00", closes: "18:00" } },
      },
      filters,
    ],
  ])("rejects a venue that fails the %s filter", (_criterion, candidate, applied) => {
    expect(suits(candidate, applied, [])).toBe(false);
  });

  it("rejects a requested period that overlaps recorded unavailability", () => {
    const overlap = {
      id: "occupied",
      label: "Occupied",
      startsAt: "2026-10-05T11:00:00",
      endsAt: "2026-10-05T13:00:00",
    };

    expect(suits(venue, filters, [overlap])).toBe(false);
  });

  it("preserves a stored requirement whose name contains the word and", () => {
    expect(
      suits(
        { ...venue, facilities: ["Sound and lighting system"] },
        { facilities: "Sound and lighting system" },
        []
      )
    ).toBe(true);
  });

  it("matches reordered and shorter requests against a longer stored tag", () => {
    expect(
      suits(
        { ...venue, facilities: ["Sound and lighting system"] },
        { facilities: "lighting sound system" },
        []
      )
    ).toBe(true);
    expect(
      suits({ ...venue, facilities: ["Sound and lighting system"] }, { facilities: "sound" }, [])
    ).toBe(true);
  });

  it("fails when a requested word names a missing concept rather than a rewording", () => {
    expect(suits({ ...venue, facilities: ["Stage"] }, { facilities: "stage lighting" }, [])).toBe(
      false
    );
    // No synonyms: "PA system" cannot match "Sound and lighting system".
    expect(
      suits(
        { ...venue, facilities: ["Sound and lighting system"] },
        { facilities: "PA system" },
        []
      )
    ).toBe(false);
  });

  it("matches stored requirements containing regular-expression punctuation", () => {
    const audioWifi = { ...venue, facilities: ["Audio (A/V) + Wi-Fi"] };
    expect(suits(audioWifi, { facilities: "Audio (A/V) + Wi-Fi" }, [])).toBe(true);
    expect(suits(audioWifi, { facilities: "Wi-Fi audio" }, [])).toBe(true);
  });

  it("accepts a venue that supports any one of the requested layouts", () => {
    expect(
      suits(
        { ...venue, supportedLayouts: ["theatre"] as const },
        { layout: "classroom, theatre" },
        []
      )
    ).toBe(true);
  });

  it("does not treat other inside another word as the Other layout", () => {
    expect(suits({ ...venue, supportedLayouts: ["other"] }, { layout: "another layout" }, [])).toBe(
      false
    );
  });

  it("leaves layout text to the handler, which refuses a filter that names no layout", () => {
    expect(parseVenueSearchRequest({ layout: "stadium" })).toMatchObject({ layout: "stadium" });
    expect(() => assertKnownLayoutText("stadium")).toThrow(LAYOUT_MESSAGE);
    expect(() => assertKnownLayoutText("stadium", INITIAL_ROOM_LAYOUTS)).toThrow(LAYOUT_MESSAGE);
    expect(assertKnownLayoutText("theatre seating", INITIAL_ROOM_LAYOUTS)).toBeUndefined();
    expect(assertKnownLayoutText(undefined, INITIAL_ROOM_LAYOUTS)).toBeUndefined();
    expect(assertKnownLayoutText("", INITIAL_ROOM_LAYOUTS)).toBeUndefined();
  });

  it("refuses a window that crosses midnight, whatever the venue's hours", () => {
    expect(
      suits(
        venue,
        { date: "2026-10-05", endDate: "2026-10-06", startTime: "22:00", endTime: "02:00" },
        []
      )
    ).toBe(false);
  });

  it("matches a multi-day window when the venue is open on every day", () => {
    // 2026-10-05 and 2026-10-06 are Monday and Tuesday. `DEFAULT_OPERATING_HOURS` closes weekends.
    expect(
      suits(
        venue,
        { date: "2026-10-05", endDate: "2026-10-06", startTime: "10:00", endTime: "12:00" },
        []
      )
    ).toBe(true);
  });

  it("refuses a multi-day window that includes a day the venue is closed", () => {
    // 2026-10-09 and 2026-10-10 are Friday and Saturday; the default hours close Saturday.
    expect(
      suits(
        venue,
        { date: "2026-10-09", endDate: "2026-10-10", startTime: "10:00", endTime: "12:00" },
        []
      )
    ).toBe(false);
  });

  it("refuses a multi-day window when a block covers only one of its days", () => {
    const tuesdayBlock = {
      id: "tuesday",
      label: "Occupied",
      startsAt: "2026-10-06T10:00:00",
      endsAt: "2026-10-06T13:00:00",
    };

    // Monday is free. Tuesday's 10:00–12:00 request falls inside the blocked period.
    expect(
      suits(
        venue,
        { date: "2026-10-05", endDate: "2026-10-06", startTime: "10:00", endTime: "12:00" },
        [tuesdayBlock]
      )
    ).toBe(false);
  });

  it("ANDs a passing filter with a failing one, refusing the venue", () => {
    expect(suits(venue, { location: "East Wing" }, [])).toBe(true);
    expect(suits(venue, { facilities: "Stage lighting" }, [])).toBe(false);
    expect(suits(venue, { location: "East Wing", facilities: "Stage lighting" }, [])).toBe(false);
  });

  it("refuses a venue that fails two filters at once", () => {
    expect(suits(venue, { location: "West Wing" }, [])).toBe(false);
    expect(suits(venue, { facilities: "Stage lighting" }, [])).toBe(false);
    expect(suits(venue, { location: "West Wing", facilities: "Stage lighting" }, [])).toBe(false);
  });
});

function failures(
  candidate: Evaluate[0],
  search: Evaluate[1],
  blocks: Evaluate[2],
  bookings: Evaluate[3] = [],
  holds: Evaluate[4] = []
) {
  return evaluateVenueSuitability(candidate, search, blocks, bookings, holds).failures;
}
function criteria(...args: Parameters<typeof failures>): SuitabilityCriterion[] {
  return failures(...args).map(failure => failure.criterion);
}

describe("PTR-30 suitability reasons", () => {
  it("names a suitable venue's verdict with no failures", () => {
    expect(evaluateVenueSuitability(venue, filters, [], [])).toEqual({
      suitable: true,
      failures: [],
    });
  });

  it("names the capacity shortfall in seats (AC2)", () => {
    // Use the larger lower bound: max(120 attendance, 150 minimum capacity) = 150.
    expect(failures({ ...venue, maxCapacity: 119 }, filters, [])).toEqual([
      { criterion: "capacity", message: "Holds 119; 150 needed" },
    ]);
    expect(
      failures({ ...venue, maxCapacity: 119 }, { ...filters, capacity: undefined }, [])
    ).toEqual([{ criterion: "capacity", message: "Holds 119; 120 needed" }]);
    // A venue that meets the minimum capacity qualifies.
    expect(criteria({ ...venue, maxCapacity: 150 }, filters, [])).toEqual([]);
  });

  it("names the missing layout, facility words and accessibility words (AC3)", () => {
    expect(
      failures(
        {
          ...venue,
          supportedLayouts: ["banquet"] as const,
          facilities: ["Projector"],
          accessibilityFeatures: ["Step-free access"],
        },
        filters,
        []
      )
    ).toEqual([
      { criterion: "layout", message: "Does not offer Theatre" },
      { criterion: "accessibility", message: "Missing accessibility: hearing loop" },
      { criterion: "facilities", message: "Missing facilities: PA system" },
    ]);
  });

  it("names every failing criterion, not only the first (AC5)", () => {
    expect(
      criteria(
        { ...venue, maxCapacity: 10, location: "West Wing", supportedLayouts: ["other"] as const },
        filters,
        []
      )
    ).toEqual(["capacity", "location", "layout"]);
  });

  it("names an approved booking that overlaps the requested window (AC4)", () => {
    const booking = {
      id: "booking-1",
      label: "Annual dinner",
      startsAt: "2026-10-05T11:00:00",
      endsAt: "2026-10-05T13:00:00",
    };
    expect(failures(venue, filters, [], [booking])).toEqual([
      { criterion: "booking", message: "Booked for Annual dinner on 2026-10-05" },
    ]);
  });

  it("does not fail a venue for a booking that ends when the window starts", () => {
    const adjacent = {
      id: "booking-2",
      label: "Morning briefing",
      startsAt: "2026-10-05T08:00:00",
      endsAt: "2026-10-05T10:00:00",
    };
    expect(suits(venue, filters, [], [adjacent])).toBe(true);
  });

  it("tells a block from a booking and a closed day from both", () => {
    const block = {
      id: "block-1",
      label: "Floor resurfacing",
      startsAt: "2026-10-05T09:00:00",
      endsAt: "2026-10-05T17:00:00",
    };
    expect(failures(venue, filters, [block])).toEqual([
      { criterion: "availability", message: "Unavailable on 2026-10-05: Floor resurfacing" },
    ]);
    expect(
      failures({ ...venue, operatingHours: { ...DEFAULT_OPERATING_HOURS, mon: null } }, filters, [])
    ).toEqual([{ criterion: "availability", message: "Not open 10:00–12:00 on 2026-10-05" }]);
    expect(
      failures(
        { ...venue, operatingHours: { ...DEFAULT_OPERATING_HOURS, mon: null } },
        { date: "2026-10-05" },
        []
      )
    ).toEqual([{ criterion: "availability", message: "Closed or unavailable on 2026-10-05" }]);
  });

  it("names the asked-for layout when an event's free-text preference matches none", () => {
    expect(failures(venue, { ...filters, layout: "Cabaret" }, [])).toEqual([
      { criterion: "layout", message: "Does not offer Cabaret" },
    ]);
  });

  it("names the booking ahead of a block that starts earlier the same day", () => {
    const block = {
      id: "block-1",
      label: "Floor resurfacing",
      startsAt: "2026-10-05T09:00:00",
      endsAt: "2026-10-05T11:00:00",
    };
    const booking = {
      id: "booking-1",
      label: "Annual dinner",
      startsAt: "2026-10-05T11:00:00",
      endsAt: "2026-10-05T13:00:00",
    };
    expect(failures(venue, filters, [block], [booking])).toEqual([
      { criterion: "booking", message: "Booked for Annual dinner on 2026-10-05" },
    ]);
  });

  it("fails a date-only range on the first day with no open time, naming a booking by its day", () => {
    const booking = {
      id: "booking-1",
      label: "Annual dinner",
      startsAt: "2026-10-06T00:00:00",
      endsAt: "2026-10-07T00:00:00",
    };
    // The 5th and 7th are open. A booking through the 6th still blocks the full range.
    expect(failures(venue, { date: "2026-10-05", endDate: "2026-10-07" }, [], [booking])).toEqual([
      { criterion: "booking", message: "Booked for Annual dinner on 2026-10-06" },
    ]);
    expect(suits(venue, { date: "2026-10-05", endDate: "2026-10-07" }, [])).toBe(true);
  });

  it("does not blame a booking outside the hours for a day the venue is closed", () => {
    const booking = {
      id: "booking-1",
      label: "Night market",
      startsAt: "2026-10-05T20:00:00",
      endsAt: "2026-10-05T23:00:00",
    };
    const closed = { ...venue, operatingHours: { ...DEFAULT_OPERATING_HOURS, mon: null } };
    expect(failures(closed, { date: "2026-10-05" }, [], [booking])).toEqual([
      { criterion: "availability", message: "Closed or unavailable on 2026-10-05" },
    ]);
  });

  it("names the requested phrases, not their words, as the Coordinator typed them", () => {
    const bare = { ...venue, accessibilityFeatures: [], facilities: ["Projector"] };
    expect(
      failures(
        bare,
        { accessibility: "Step-free access and hearing loop", facilities: "projector, PA system" },
        []
      )
    ).toEqual([
      {
        criterion: "accessibility",
        message: "Missing accessibility: Step-free access, hearing loop",
      },
      { criterion: "facilities", message: "Missing facilities: PA system" },
    ]);
  });

  it("names a window that crosses midnight rather than failing silently", () => {
    expect(
      failures(
        venue,
        { date: "2026-10-05", endDate: "2026-10-06", startTime: "22:00", endTime: "02:00" },
        []
      )
    ).toEqual([{ criterion: "availability", message: "The requested window crosses midnight" }]);
  });

  it("names the tentative hold as an unsuitable reason (PTR-109 AC6)", () => {
    const hold = {
      id: "hold-1",
      label: "Tentatively held",
      startsAt: "2026-10-05T10:00:00",
      endsAt: "2026-10-05T12:00:00",
    };
    expect(failures(venue, filters, [], [], [hold])).toEqual([
      { criterion: "hold", message: "Tentatively held on 2026-10-05" },
    ]);
    expect(suits(venue, filters, [], [], [hold])).toBe(false);
  });

  it("names the booking ahead of a tentative hold for the same window", () => {
    const booking = {
      id: "booking-1",
      label: "Annual dinner",
      startsAt: "2026-10-05T10:00:00",
      endsAt: "2026-10-05T12:00:00",
    };
    const hold = {
      id: "hold-1",
      label: "Tentatively held",
      startsAt: "2026-10-05T10:00:00",
      endsAt: "2026-10-05T12:00:00",
    };
    expect(failures(venue, filters, [], [booking], [hold])).toEqual([
      { criterion: "booking", message: "Booked for Annual dinner on 2026-10-05" },
    ]);
  });
});

/**
 * PTR-138 AC1: request creation checks a venue against the session's requirements with the same
 * rule that search applies. Location and availability are not part of it.
 */
describe("PTR-138 requirementFailures", () => {
  const session = {
    expectedAttendance: 120,
    layout: "Theatre seating",
    accessibility: "Step-free access, hearing loop",
    facilities: "projector, PA system",
  };

  it("names no failure when the venue meets every requirement", () => {
    expect(requirementFailures(venue, session)).toEqual([]);
  });

  it("names no failure for blank requirements", () => {
    expect(
      requirementFailures(
        {
          ...venue,
          maxCapacity: 1,
          facilities: [],
          accessibilityFeatures: [],
          supportedLayouts: [],
        },
        { layout: "", accessibility: "", facilities: "" }
      )
    ).toEqual([]);
  });

  it("names every failing requirement in one list, in a fixed order", () => {
    expect(
      requirementFailures(
        {
          maxCapacity: 40,
          supportedLayouts: ["boardroom"],
          accessibilityFeatures: ["Hearing loop"],
          facilities: ["Whiteboard"],
        },
        session
      )
    ).toEqual([
      { criterion: "capacity", message: "Holds 40; 120 needed" },
      { criterion: "layout", message: "Does not offer Theatre" },
      { criterion: "accessibility", message: "Missing accessibility: Step-free access" },
      { criterion: "facilities", message: "Missing facilities: projector, PA system" },
    ]);
  });

  it("uses the larger of attendance and minimum capacity", () => {
    expect(requirementFailures(venue, { expectedAttendance: 120, capacity: 250 })).toEqual([
      { criterion: "capacity", message: "Holds 200; 250 needed" },
    ]);
  });

  it("names a free-text layout that names no known layout", () => {
    expect(requirementFailures(venue, { layout: "Round tables" })).toEqual([
      { criterion: "layout", message: "Does not offer Round tables" },
    ]);
  });

  it("gives search the same requirement failures, with location after capacity", () => {
    const candidate = {
      ...venue,
      maxCapacity: 40,
      location: "West Wing",
      supportedLayouts: ["boardroom"] as const,
    };
    const searched = failures(candidate, filters, []);
    const required = requirementFailures(candidate, filters);
    expect(searched.filter(failure => failure.criterion !== "location")).toEqual(required);
    expect(searched.map(failure => failure.criterion)).toEqual(["capacity", "location", "layout"]);
    // Without a capacity failure, location comes first.
    expect(criteria({ ...candidate, maxCapacity: 200 }, filters, [])).toEqual([
      "location",
      "layout",
    ]);
  });
});

/**
 * PTR-138 AC1: a request window gets search's availability rule, without bookings or holds. The
 * ledger checks those. 2026-10-05 is a Monday, and the venue opens 08:00–22:00 on weekdays.
 */
describe("PTR-138 windowAvailabilityFailure", () => {
  const window = {
    operatingHours: DEFAULT_OPERATING_HOURS,
    startsAt: "2026-10-05 10:00:00",
    endsAt: "2026-10-05 12:00:00",
  };
  const block = {
    id: "1",
    label: "Floor resurfacing",
    startsAt: "2026-10-05T11:00:00",
    endsAt: "2026-10-05T13:00:00",
  };

  it("names no failure for an open, unblocked window", () => {
    expect(windowAvailabilityFailure(window, [])).toBeNull();
    // A block that only touches the window leaves it free.
    expect(
      windowAvailabilityFailure({ ...window, endsAt: "2026-10-05 11:00:00" }, [block])
    ).toBeNull();
  });

  it("names a window outside the opening hours, in search's words", () => {
    expect(windowAvailabilityFailure({ ...window, startsAt: "2026-10-05 07:00:00" }, [])).toEqual({
      criterion: "availability",
      message: "Not open 07:00–12:00 on 2026-10-05",
    });
    // The venue is closed on Saturdays.
    expect(
      windowAvailabilityFailure(
        { ...window, startsAt: "2026-10-10 10:00:00", endsAt: "2026-10-10 12:00:00" },
        []
      )
    ).toEqual({ criterion: "availability", message: "Not open 10:00–12:00 on 2026-10-10" });
  });

  it("names a recorded block that overlaps the window", () => {
    expect(windowAvailabilityFailure(window, [block])).toEqual({
      criterion: "availability",
      message: "Unavailable on 2026-10-05: Floor resurfacing",
    });
  });
});

describe("PTR-135 buffered occupancy in search", () => {
  // The ledger reader returns each commitment's occupied period: its requested times extended by
  // its stored buffers. A 10:00–12:00 booking at a venue with 30 minutes setup and 45 minutes
  // turnaround occupies 09:30–12:45.
  const bufferedBooking = {
    id: "booking-1",
    label: "another event",
    startsAt: "2026-10-05T09:30:00",
    endsAt: "2026-10-05T12:45:00",
  };

  it("refuses a window that overlaps only another booking's turnaround buffer", () => {
    expect(
      failures(
        venue,
        { date: "2026-10-05", startTime: "12:30", endTime: "13:00" },
        [],
        [bufferedBooking]
      )
    ).toEqual([{ criterion: "booking", message: "Booked for another event on 2026-10-05" }]);
  });

  it("leaves a window that touches the buffer end free", () => {
    expect(
      suits(
        venue,
        { date: "2026-10-05", startTime: "12:45", endTime: "13:00" },
        [],
        [bufferedBooking]
      )
    ).toBe(true);
  });

  it("refuses a window that overlaps only a hold's setup buffer", () => {
    const bufferedHold = {
      id: "hold-1",
      label: "tentative hold",
      startsAt: "2026-10-05T09:30:00",
      endsAt: "2026-10-05T10:00:00",
    };
    expect(
      failures(
        venue,
        { date: "2026-10-05", startTime: "09:00", endTime: "09:35" },
        [],
        [],
        [bufferedHold]
      )
    ).toEqual([{ criterion: "hold", message: "Tentatively held on 2026-10-05" }]);
  });
});

describe("PTR-161 AC7 unknown event layout prefill", () => {
  it("ignores an event-defaulted layout that names no maintained layout", () => {
    expect(resolveSearchLayout("Stadium concert", false, INITIAL_ROOM_LAYOUTS)).toBeUndefined();
  });

  it("keeps a layout that names a maintained layout, or no layout at all", () => {
    expect(resolveSearchLayout("Theatre seating", false, INITIAL_ROOM_LAYOUTS)).toBe(
      "Theatre seating"
    );
    expect(resolveSearchLayout(undefined, false, INITIAL_ROOM_LAYOUTS)).toBeUndefined();
  });

  it("refuses an explicitly supplied layout that names no maintained layout", () => {
    expect(() => resolveSearchLayout("Stadium concert", true, INITIAL_ROOM_LAYOUTS)).toThrow(
      LAYOUT_MESSAGE
    );
  });
});

describe("PTR-161 AC8 candidate buffers in search", () => {
  // A venue with 60 minutes setup and turnaround. A 10:00–12:00 booking with no stored buffers
  // occupies exactly 10:00–12:00. Approval expands the candidate window by the venue's buffers
  // (`checkVenueFree`/`overlapsPeriod`, ADR-7), so it refuses 12:30–13:00 (buffered 11:30–14:00
  // overlaps the booking) but takes 13:00–14:00 (buffered 12:00–15:00 only touches it).
  const bufferedVenue = { ...venue, setupMinutes: 60, turnaroundMinutes: 60 };
  // The edge windows sit outside default hours (00:30 and past 22:00), so run these cases
  // all day: refusal then comes from the buffer alone, not from closing time.
  const allDayHours: OperatingHours = {
    mon: { opens: "00:00", closes: "23:59" },
    tue: { opens: "00:00", closes: "23:59" },
    wed: { opens: "00:00", closes: "23:59" },
    thu: { opens: "00:00", closes: "23:59" },
    fri: { opens: "00:00", closes: "23:59" },
    sat: { opens: "00:00", closes: "23:59" },
    sun: { opens: "00:00", closes: "23:59" },
  };
  const allDayBufferedVenue = { ...bufferedVenue, operatingHours: allDayHours };
  const booking = {
    id: "booking-1",
    label: "Annual dinner",
    startsAt: "2026-10-05T10:00:00",
    endsAt: "2026-10-05T12:00:00",
  };

  it("shifts a day time across midnight", () => {
    expect(shiftedDayTime("2026-10-05", "00:30", -60)).toBe("2026-10-04T23:30:00");
    expect(shiftedDayTime("2026-10-05", "23:30", 60)).toBe("2026-10-06T00:30:00");
    expect(shiftedDayTime("2026-10-05", "10:00", 0)).toBe("2026-10-05T10:00:00");
  });

  it("reports unsuitable with the booking reason for a window approval would refuse solely because of a buffer", () => {
    expect(
      failures(
        bufferedVenue,
        { date: "2026-10-05", startTime: "12:30", endTime: "13:00" },
        [],
        [booking]
      )
    ).toEqual([{ criterion: "booking", message: "Booked for Annual dinner on 2026-10-05" }]);
  });

  it("leaves a window that only touches the buffered booking free", () => {
    expect(
      suits(
        bufferedVenue,
        { date: "2026-10-05", startTime: "13:00", endTime: "14:00" },
        [],
        [booking]
      )
    ).toBe(true);
  });

  it("reports unsuitable with the hold reason for a buffer-only hold overlap", () => {
    const hold = {
      id: "hold-1",
      label: "tentative hold",
      startsAt: "2026-10-05T10:00:00",
      endsAt: "2026-10-05T12:00:00",
    };
    expect(
      failures(
        bufferedVenue,
        { date: "2026-10-05", startTime: "12:30", endTime: "13:00" },
        [],
        [],
        [hold]
      )
    ).toEqual([{ criterion: "hold", message: "Tentatively held on 2026-10-05" }]);
  });

  it("reports unsuitable with the block reason for a buffer-only block overlap", () => {
    const block = {
      id: "block-1",
      label: "Floor resurfacing",
      startsAt: "2026-10-05T10:00:00",
      endsAt: "2026-10-05T12:00:00",
    };
    expect(
      failures(
        bufferedVenue,
        { date: "2026-10-05", startTime: "12:30", endTime: "13:00" },
        [block],
        []
      )
    ).toEqual([
      { criterion: "availability", message: "Unavailable on 2026-10-05: Floor resurfacing" },
    ]);
  });

  it("compares the raw window when the venue holds no buffers", () => {
    expect(
      suits(venue, { date: "2026-10-05", startTime: "12:30", endTime: "13:00" }, [], [booking])
    ).toBe(true);
  });

  it("refuses a window whose setup buffer reaches a booking before the requested date, naming the booking's day", () => {
    const beforeRange = {
      id: "booking-1",
      label: "Annual dinner",
      startsAt: "2026-10-04T22:00:00",
      endsAt: "2026-10-04T23:45:00",
    };
    // The buffered window starts at 23:30 on the 4th and overlaps the booking. Approval expands
    // the candidate the same way, so it refuses this window too.
    expect(
      failures(
        allDayBufferedVenue,
        { date: "2026-10-05", startTime: "00:30", endTime: "01:30" },
        [],
        [beforeRange]
      )
    ).toEqual([{ criterion: "booking", message: "Booked for Annual dinner on 2026-10-04" }]);
  });

  it("refuses a window whose turnaround buffer reaches a booking after the requested date, naming the booking's day", () => {
    const afterRange = {
      id: "booking-1",
      label: "Annual dinner",
      startsAt: "2026-10-06T00:00:00",
      endsAt: "2026-10-06T01:00:00",
    };
    // The buffered window ends at 00:30 on the 6th and overlaps the booking.
    expect(
      failures(
        allDayBufferedVenue,
        { date: "2026-10-05", startTime: "22:00", endTime: "23:30" },
        [],
        [afterRange]
      )
    ).toEqual([{ criterion: "booking", message: "Booked for Annual dinner on 2026-10-06" }]);
  });
});
