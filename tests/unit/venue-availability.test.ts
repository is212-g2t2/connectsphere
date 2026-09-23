import { describe, expect, it } from "vitest";

import { openingPeriods, projectAvailability } from "#/features/venues/availability";
import {
  AVAILABILITY_ORDER_MESSAGE,
  AVAILABILITY_RANGE_MESSAGE,
  DEFAULT_OPERATING_HOURS,
  VENUE_ID_MESSAGE,
  parseAvailabilityRequest,
  parseAvailabilitySelection,
} from "#/features/venues/schema";

/** 2026-10-05 is a Monday; the fixture hours below are open Mon-Fri, closed at the weekend. */
function day(dayOfMonth: number, time: string) {
  return `2026-10-${String(dayOfMonth).padStart(2, "0")}T${time}`;
}

const range = { startsAt: day(5, "00:00:00"), endsAt: day(8, "00:00:00") };

function record(id: string, startsAt: string, endsAt: string, label: string) {
  return { id, startsAt, endsAt, label };
}

function source(overrides: Partial<Parameters<typeof projectAvailability>[1]> = {}) {
  return {
    bookings: [],
    blocks: [],
    openPeriods: openingPeriods("2026-10-05", "2026-10-07", DEFAULT_OPERATING_HOURS),
    ...overrides,
  };
}

describe("PTR-28 availability projection", () => {
  it("[AC2][AC4] reports a recorded block and the free periods around it", () => {
    const projection = projectAvailability(
      range,
      source({ blocks: [record("1", day(5, "13:00:00"), day(5, "15:00:00"), "Maintenance")] })
    );

    expect(projection.occupied).toEqual([
      {
        id: "1",
        state: "blocked",
        label: "Maintenance",
        startsAt: day(5, "13:00:00"),
        endsAt: day(5, "15:00:00"),
        visibleStart: day(5, "13:00:00"),
        visibleEnd: day(5, "15:00:00"),
      },
    ]);
    expect(projection.available.map(period => [period.startsAt, period.endsAt])).toEqual([
      [day(5, "08:00:00"), day(5, "13:00:00")],
      [day(5, "15:00:00"), day(5, "22:00:00")],
      [day(6, "08:00:00"), day(6, "22:00:00")],
      [day(7, "08:00:00"), day(7, "22:00:00")],
    ]);
  });

  /**
   * The projection's confirmed state, pinned as pure logic: `loadVenueBookings` feeds it live
   * approved bookings (PTR-36), and this keeps the rendering rule independent of that query.
   */
  it("renders an approved booking as a confirmed period (PTR-36)", () => {
    const projection = projectAvailability(
      range,
      source({
        bookings: [record("9", day(5, "10:00:00"), day(5, "12:00:00"), "Confirmed booking")],
      })
    );

    expect(projection.occupied).toHaveLength(1);
    expect(projection.occupied[0]).toMatchObject({
      state: "confirmed",
      label: "Confirmed booking",
    });
  });

  it("clips records to the range and drops the ones that only touch it", () => {
    const projection = projectAvailability(
      range,
      source({
        blocks: [
          record("2", "2026-10-04T23:00:00", day(5, "02:00:00"), "Overnight closure"),
          record("3", day(7, "20:00:00"), day(8, "01:00:00"), "Late works"),
          record("4", "2026-10-01T09:00:00", range.startsAt, "Before the range"),
        ],
      })
    );

    expect(projection.occupied.map(period => [period.visibleStart, period.visibleEnd])).toEqual([
      [range.startsAt, day(5, "02:00:00")],
      [day(7, "20:00:00"), range.endsAt],
    ]);
  });

  it("throws rather than reporting a venue available when a record is malformed", () => {
    expect(() =>
      projectAvailability(
        range,
        source({ blocks: [record("bad", day(5, "15:00:00"), day(5, "13:00:00"), "Backwards")] })
      )
    ).toThrow("Availability contains an invalid period");
  });

  it("does not assume a venue is open when it has no opening periods", () => {
    const projection = projectAvailability(range, source({ openPeriods: [] }));

    expect(projection.available).toEqual([]);
  });
});

describe("PTR-28 opening periods", () => {
  it("returns one period per open weekday and none for a closed day", () => {
    const periods = openingPeriods("2026-10-09", "2026-10-12", DEFAULT_OPERATING_HOURS);

    expect(periods).toEqual([
      { startsAt: day(9, "08:00:00"), endsAt: day(9, "22:00:00") },
      { startsAt: day(12, "08:00:00"), endsAt: day(12, "22:00:00") },
    ]);
  });
});

describe("PTR-28 availability selection", () => {
  it("accepts search-parameter strings and returns a typed selection", () => {
    expect(
      parseAvailabilityRequest({ venueId: "7", startDate: "2026-10-05", endDate: "2026-10-07" })
    ).toEqual({ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-07" });
  });

  it.each([
    [{ venueId: "", startDate: "2026-10-05", endDate: "2026-10-05" }, VENUE_ID_MESSAGE],
    [{ venueId: "VA", startDate: "2026-10-05", endDate: "2026-10-05" }, VENUE_ID_MESSAGE],
    [{ venueId: "2147483648", startDate: "2026-10-05", endDate: "2026-10-05" }, VENUE_ID_MESSAGE],
    [{ venueId: "7", startDate: "2026-10-05", endDate: "2026-02-30" }, "Choose an end date"],
    [{ venueId: "7", startDate: "2026-10-06", endDate: "2026-10-05" }, AVAILABILITY_ORDER_MESSAGE],
    [{ venueId: "7", startDate: "2026-10-05", endDate: "2027-10-06" }, AVAILABILITY_RANGE_MESSAGE],
  ])("refuses %j with its own message", (selection, message) => {
    expect(() => parseAvailabilityRequest(selection)).toThrow(message);
  });

  it("treats a partial search as no selection rather than an error", () => {
    expect(parseAvailabilitySelection({ venueId: 7 })).toBeNull();
    expect(parseAvailabilitySelection({})).toBeNull();
    expect(
      parseAvailabilitySelection({ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-07" })
    ).toEqual({ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-07" });
  });
});
