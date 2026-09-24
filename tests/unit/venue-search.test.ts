import { describe, expect, it } from "vitest";

import { evaluateVenueSuitability } from "#/features/venues/records.server";
import type { SuitabilityCriterion } from "#/features/venues/records.server";
import {
  AVAILABILITY_RANGE_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  LAYOUT_MESSAGE,
  VENUE_SEARCH_TIME_MESSAGE,
  parseVenueSearchRequest,
} from "#/features/venues/schema";

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

/** PTR-29's yes/no reading of the verdict PTR-30 widened it into; no bookings unless given. */
function suits(
  candidate: Evaluate[0],
  search: Evaluate[1],
  blocks: Evaluate[2],
  bookings: Evaluate[3] = []
) {
  return evaluateVenueSuitability(candidate, search, blocks, bookings).suitable;
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

  it("refuses a layout filter that names no supported layout", () => {
    expect(() => parseVenueSearchRequest({ layout: "stadium" })).toThrow(LAYOUT_MESSAGE);
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
    // 2026-10-05 and 2026-10-06 are Monday and Tuesday; `DEFAULT_OPERATING_HOURS` closes the weekend.
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

    // Monday is free, Tuesday's requested 10:00–12:00 sits inside the block.
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
  bookings: Evaluate[3] = []
) {
  return evaluateVenueSuitability(candidate, search, blocks, bookings).failures;
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
    // The stricter of the two lower bounds (attendance 120, minimum capacity 150) is the number.
    expect(failures({ ...venue, maxCapacity: 119 }, filters, [])).toEqual([
      { criterion: "capacity", message: "Holds 119; 150 needed" },
    ]);
    expect(
      failures({ ...venue, maxCapacity: 119 }, { ...filters, capacity: undefined }, [])
    ).toEqual([{ criterion: "capacity", message: "Holds 119; 120 needed" }]);
    // Exactly enough is enough.
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
    // The 5th and the 7th are open; a venue booked right through the 6th cannot host the range.
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
});
