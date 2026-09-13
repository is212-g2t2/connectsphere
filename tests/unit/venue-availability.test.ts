import { beforeEach, describe, expect, it } from "vitest";

import { projectAvailability, parseAvailabilityRequest } from "#/features/venues/availability";
import { createPtr28Fixture, fixtureTime } from "../fixtures/ptr-28";

describe("PTR-28 availability projection (pure unit coverage; no database or endpoint)", () => {
  let fixture = createPtr28Fixture();
  beforeEach(() => {
    fixture = createPtr28Fixture();
  });

  function project(range = fixture.ranges.R1, venueId = "VA") {
    return projectAvailability(
      { venueId, ...range },
      {
        bookings: fixture.bookings,
        blocks: fixture.blocks,
        // Explicit all-day openings isolate the projection from product operating-hours policy.
        openPeriods: [range],
        pendingTreatment: "no-hold",
      }
    );
  }

  it("[PTR-28-TC05][AC2] separates available, confirmed and blocked periods", () => {
    const result = project(fixture.ranges.R3);
    expect(result.occupied.map(record => [record.id, record.state])).toEqual([
      ["B01", "confirmed"],
      ["U01", "blocked"],
    ]);
    expect(result.available).toContainEqual({
      startsAt: fixtureTime(5, "00:00"),
      endsAt: fixtureTime(5, "10:00"),
    });
    expect(result.available).toContainEqual({
      startsAt: fixtureTime(5, "12:00"),
      endsAt: fixtureTime(5, "13:00"),
    });
  });

  it("[PTR-28-TC06][AC3] preserves exact 10:15–11:45 booking times", () => {
    fixture.bookings[0].startsAt = fixtureTime(5, "10:15");
    fixture.bookings[0].endsAt = fixtureTime(5, "11:45");
    const booking = project(fixture.ranges.R3).occupied.find(record => record.id === "B01");
    expect(booking).toMatchObject({
      startsAt: fixtureTime(5, "10:15"),
      endsAt: fixtureTime(5, "11:45"),
      state: "confirmed",
    });
  });

  it("[PTR-28-TC07][AC3] includes another coordinator's booking in the projection", () => {
    expect(fixture.events.find(event => event.id === "E02")?.coordinatorId).toBe("COORD-B");
    expect(project().occupied).toContainEqual(
      expect.objectContaining({
        id: "B02",
        startsAt: fixtureTime(6, "14:00"),
        endsAt: fixtureTime(6, "16:00"),
      })
    );
  });

  it("[PTR-28-TC08][AC3] retains an overnight booking's original extent", () => {
    expect(project().occupied).toContainEqual(
      expect.objectContaining({
        id: "B03",
        startsAt: fixtureTime(6, "23:00"),
        endsAt: fixtureTime(7, "01:00"),
      })
    );
  });

  it.each([
    {
      variant: "A",
      id: "BX1",
      startsAt: fixtureTime(4, "23:00"),
      endsAt: fixtureTime(5, "01:00"),
      visibleStart: fixtureTime(5, "00:00"),
      visibleEnd: fixtureTime(5, "01:00"),
    },
    {
      variant: "B",
      id: "BX2",
      startsAt: fixtureTime(7, "23:00"),
      endsAt: fixtureTime(8, "01:00"),
      visibleStart: fixtureTime(7, "23:00"),
      visibleEnd: fixtureTime(8, "00:00"),
    },
  ])(
    "[PTR-28-TC09-$variant][AC1][AC3] includes overlap without changing stored times",
    ({ id, startsAt, endsAt, visibleStart, visibleEnd }) => {
      fixture.bookings.push({
        id,
        venueId: "VA",
        eventId: "E01",
        status: "approved",
        startsAt,
        endsAt,
      });
      const before = structuredClone(fixture.bookings);
      expect(project().occupied).toContainEqual(
        expect.objectContaining({ id, startsAt, endsAt, visibleStart, visibleEnd })
      );
      expect(fixture.bookings).toEqual(before);
    }
  );

  it.each([
    { variant: "A", id: "B04" },
    { variant: "B", id: "U03" },
    { variant: "C", id: "B05" },
    { variant: "D", id: "U04" },
  ])(
    "[PTR-28-TC10-$variant][AC1][AC3][AC4] excludes $id while retaining positive controls",
    ({ id }) => {
      const ids = project().occupied.map(record => record.id);
      expect(ids).toContain("B01");
      expect(ids).toContain("U01");
      expect(ids).not.toContain(id);
    }
  );

  it("[PTR-28-TC11][AC2][AC4] returns blocks alongside bookings", () => {
    expect(project(fixture.ranges.R3).occupied.map(record => record.id)).toEqual(["B01", "U01"]);
  });

  it("[PTR-28-TC12][AC4] returns blocks independently of bookings", () => {
    fixture.bookings = [];
    expect(project(fixture.ranges.R3).occupied).toEqual([
      expect.objectContaining({
        id: "U01",
        state: "blocked",
        startsAt: fixtureTime(5, "13:00"),
        endsAt: fixtureTime(5, "15:00"),
      }),
    ]);
  });

  it("[PTR-28-TC16][AC2] derives an available day only from explicitly supplied opening periods", () => {
    fixture.bookings = [];
    fixture.blocks = [];
    expect(project(fixture.ranges.R3)).toEqual({ occupied: [], available: [fixture.ranges.R3] });
  });

  it("[PTR-28-TC17][AC2][AC3] never labels a pending request as confirmed", () => {
    const result = project(fixture.ranges.R3);
    expect(result.occupied.some(record => record.id === "P01")).toBe(false);
    expect(result.occupied.map(record => record.id)).toEqual(["B01", "U01"]);
    // The pending-hold policy is unresolved; no assertion that 16:00–17:00 is available.
  });

  it("[PTR-28-TC05][AC2] preserves overlapping booking/block records without false free gaps", () => {
    fixture.blocks[0].startsAt = fixtureTime(5, "11:00");
    const result = project(fixture.ranges.R3);
    expect(result.occupied.map(record => record.id)).toEqual(["B01", "U01"]);
    expect(result.available).toEqual([
      { startsAt: fixtureTime(5, "00:00"), endsAt: fixtureTime(5, "10:00") },
      { startsAt: fixtureTime(5, "15:00"), endsAt: fixtureTime(6, "00:00") },
    ]);
  });

  it("[PTR-28-TC16][AC2] does not assume a venue is open when opening periods are absent", () => {
    expect(
      projectAvailability(
        { venueId: "VA", ...fixture.ranges.R3 },
        { bookings: [], blocks: [], openPeriods: [], pendingTreatment: "no-hold" }
      )
    ).toEqual({ occupied: [], available: [] });
  });

  it("[PTR-28-TC17][AC2][AC3] requires the caller's pending-hold policy and supports a hold without confirmation", () => {
    const result = projectAvailability(
      { venueId: "VA", ...fixture.ranges.R3 },
      {
        bookings: fixture.bookings,
        blocks: fixture.blocks,
        openPeriods: [fixture.ranges.R3],
        pendingTreatment: "hold",
      }
    );
    expect(result.occupied).toContainEqual(
      expect.objectContaining({ id: "P01", state: "blocked" })
    );
    expect(
      result.available.some(
        period =>
          Date.parse(period.startsAt) <= Date.parse(fixtureTime(5, "16:00")) &&
          Date.parse(period.endsAt) > Date.parse(fixtureTime(5, "16:00"))
      )
    ).toBe(false);
  });
});

describe("PTR-28 explicit-instant request validation (proposed adapter contract)", () => {
  const valid = { venueId: "VA", ...createPtr28Fixture().ranges.R1 };

  it.each([
    { variant: "A", data: { ...valid, venueId: "" }, message: "Select a venue" },
    { variant: "C", data: { ...valid, startsAt: "2026-99-99" }, message: "Start time" },
    { variant: "D", data: { ...valid, endsAt: fixtureTime(4, "00:00") }, message: "End time" },
    { variant: "E", data: { venueId: "VA", startsAt: valid.startsAt }, message: "End time" },
  ])(
    "[PTR-28-TC15-$variant][AC1] rejects invalid input with a plain message",
    ({ data, message }) => {
      expect(() => parseAvailabilityRequest(data)).toThrow(message);
      let actualError: unknown;
      try {
        parseAvailabilityRequest(data);
      } catch (error) {
        actualError = error;
      }
      expect(actualError).toBeInstanceOf(Error);
      expect(actualError).not.toHaveProperty("issues");
    }
  );

  it("[PTR-28-TC15][AC1] compares offset timestamps by instant rather than text", () => {
    expect(
      parseAvailabilityRequest({
        venueId: "VA",
        startsAt: "2026-10-05T10:00:00+08:00",
        endsAt: "2026-10-05T03:00:00Z",
      })
    ).toEqual({
      venueId: "VA",
      startsAt: "2026-10-05T10:00:00+08:00",
      endsAt: "2026-10-05T03:00:00Z",
    });
  });
});
