import { describe, expect, it } from "vitest";

import { evaluateVenueSuitability } from "#/features/venues/records.server";
import {
  AVAILABILITY_RANGE_MESSAGE,
  DEFAULT_OPERATING_HOURS,
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

  it("matches stored requirements containing regular-expression punctuation", () => {
    expect(
      evaluateVenueSuitability(
        { ...venue, facilities: ["Audio (A/V) + Wi-Fi"] },
        { facilities: "Audio (A/V) + Wi-Fi" },
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
});
