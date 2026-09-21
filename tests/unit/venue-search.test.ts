import { describe, expect, it } from "vitest";

import { evaluateVenueSuitability } from "#/features/venues/records.server";
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

describe("PTR-29 suitability rules", () => {
  it("accepts a venue only when every applied filter passes", () => {
    expect(evaluateVenueSuitability(venue, filters, [])).toBe(true);
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
    expect(evaluateVenueSuitability(candidate, applied, [])).toBe(false);
  });

  it("rejects a requested period that overlaps recorded unavailability", () => {
    const overlap = {
      id: "occupied",
      label: "Occupied",
      startsAt: "2026-10-05T11:00:00",
      endsAt: "2026-10-05T13:00:00",
    };

    expect(evaluateVenueSuitability(venue, filters, [overlap])).toBe(false);
  });

  it("preserves a stored requirement whose name contains the word and", () => {
    expect(
      evaluateVenueSuitability(
        { ...venue, facilities: ["Sound and lighting system"] },
        { facilities: "Sound and lighting system" },
        []
      )
    ).toBe(true);
  });

  it("matches reordered and shorter requests against a longer stored tag", () => {
    expect(
      evaluateVenueSuitability(
        { ...venue, facilities: ["Sound and lighting system"] },
        { facilities: "lighting sound system" },
        []
      )
    ).toBe(true);
    expect(
      evaluateVenueSuitability(
        { ...venue, facilities: ["Sound and lighting system"] },
        { facilities: "sound" },
        []
      )
    ).toBe(true);
  });

  it("fails when a requested word names a missing concept rather than a rewording", () => {
    expect(
      evaluateVenueSuitability(
        { ...venue, facilities: ["Stage"] },
        { facilities: "stage lighting" },
        []
      )
    ).toBe(false);
    // No synonyms: "PA system" cannot match "Sound and lighting system".
    expect(
      evaluateVenueSuitability(
        { ...venue, facilities: ["Sound and lighting system"] },
        { facilities: "PA system" },
        []
      )
    ).toBe(false);
  });

  it("matches stored requirements containing regular-expression punctuation", () => {
    const audioWifi = { ...venue, facilities: ["Audio (A/V) + Wi-Fi"] };
    expect(evaluateVenueSuitability(audioWifi, { facilities: "Audio (A/V) + Wi-Fi" }, [])).toBe(
      true
    );
    expect(evaluateVenueSuitability(audioWifi, { facilities: "Wi-Fi audio" }, [])).toBe(true);
  });

  it("accepts a venue that supports any one of the requested layouts", () => {
    expect(
      evaluateVenueSuitability(
        { ...venue, supportedLayouts: ["theatre"] as const },
        { layout: "classroom, theatre" },
        []
      )
    ).toBe(true);
  });

  it("does not treat other inside another word as the Other layout", () => {
    expect(
      evaluateVenueSuitability(
        { ...venue, supportedLayouts: ["other"] },
        { layout: "another layout" },
        []
      )
    ).toBe(false);
  });

  it("refuses a layout filter that names no supported layout", () => {
    expect(() => parseVenueSearchRequest({ layout: "stadium" })).toThrow(LAYOUT_MESSAGE);
  });

  it("refuses a window that crosses midnight, whatever the venue's hours", () => {
    expect(
      evaluateVenueSuitability(
        venue,
        { date: "2026-10-05", endDate: "2026-10-06", startTime: "22:00", endTime: "02:00" },
        []
      )
    ).toBe(false);
  });

  it("matches a multi-day window when the venue is open on every day", () => {
    // 2026-10-05 and 2026-10-06 are Monday and Tuesday; `DEFAULT_OPERATING_HOURS` closes the weekend.
    expect(
      evaluateVenueSuitability(
        venue,
        { date: "2026-10-05", endDate: "2026-10-06", startTime: "10:00", endTime: "12:00" },
        []
      )
    ).toBe(true);
  });

  it("refuses a multi-day window that includes a day the venue is closed", () => {
    // 2026-10-09 and 2026-10-10 are Friday and Saturday; the default hours close Saturday.
    expect(
      evaluateVenueSuitability(
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
      evaluateVenueSuitability(
        venue,
        { date: "2026-10-05", endDate: "2026-10-06", startTime: "10:00", endTime: "12:00" },
        [tuesdayBlock]
      )
    ).toBe(false);
  });

  it("ANDs a passing filter with a failing one, refusing the venue", () => {
    expect(evaluateVenueSuitability(venue, { location: "East Wing" }, [])).toBe(true);
    expect(evaluateVenueSuitability(venue, { facilities: "Stage lighting" }, [])).toBe(false);
    expect(
      evaluateVenueSuitability(venue, { location: "East Wing", facilities: "Stage lighting" }, [])
    ).toBe(false);
  });

  it("refuses a venue that fails two filters at once", () => {
    expect(evaluateVenueSuitability(venue, { location: "West Wing" }, [])).toBe(false);
    expect(evaluateVenueSuitability(venue, { facilities: "Stage lighting" }, [])).toBe(false);
    expect(
      evaluateVenueSuitability(venue, { location: "West Wing", facilities: "Stage lighting" }, [])
    ).toBe(false);
  });
});
