import { beforeEach, describe, expect, it } from "vitest";

import { parseAvailabilityInput, projectAvailability } from "#/features/venues/server-fns";
import { createPtr28Fixture, fixtureTime } from "../fixtures/ptr-28";

describe("PTR-28 availability projection (pure block coverage)", () => {
  let fixture = createPtr28Fixture();
  beforeEach(() => {
    fixture = createPtr28Fixture();
  });

  function project(range = fixture.ranges.R1, venueId = "VA") {
    return projectAvailability(
      { venueId, ...range },
      {
        blocks: fixture.blocks,
        // Explicit all-day openings isolate the projection from product operating-hours policy.
        openPeriods: [range],
      }
    );
  }

  it("[PTR-28-TC11][AC4] returns blocks in the availability projection", () => {
    expect(project(fixture.ranges.R3).occupied).toEqual([
      expect.objectContaining({
        id: "U01",
        state: "blocked",
        startsAt: fixtureTime(5, "13:00"),
        endsAt: fixtureTime(5, "15:00"),
      }),
    ]);
  });

  it("[PTR-28-TC12][AC4] excludes blocks for another venue", () => {
    const ids = project().occupied.map(record => record.id);
    expect(ids).toContain("U01");
    expect(ids).not.toContain("U03");
  });

  it("[PTR-28-TC16][AC2] derives an available period only from explicitly supplied openings", () => {
    fixture.blocks = [];
    expect(project(fixture.ranges.R3)).toEqual({
      occupied: [],
      available: [fixture.ranges.R3],
    });
  });

  it("[PTR-28-TC16][AC2] does not assume a venue is open when openings are absent", () => {
    expect(
      projectAvailability({ venueId: "VA", ...fixture.ranges.R3 }, { blocks: [], openPeriods: [] })
    ).toEqual({ occupied: [], available: [] });
  });

  it("preserves separate periods when a block splits an opening", () => {
    fixture.blocks[0].startsAt = fixtureTime(5, "11:00");
    expect(project(fixture.ranges.R3).available).toEqual([
      { startsAt: fixtureTime(5, "00:00"), endsAt: fixtureTime(5, "11:00") },
      { startsAt: fixtureTime(5, "15:00"), endsAt: fixtureTime(6, "00:00") },
    ]);
  });

  it("rejects a range whose end is not after its start", () => {
    expect(() =>
      projectAvailability(
        {
          venueId: "VA",
          startsAt: fixtureTime(5, "12:00"),
          endsAt: fixtureTime(5, "12:00"),
        },
        { blocks: [], openPeriods: [] }
      )
    ).toThrow("invalid range");
  });
});

describe("PTR-28 availability server-function validation", () => {
  const dates = { startDate: "2026-10-05", endDate: "2026-10-07" };

  it("parses a PostgreSQL-safe numeric venue ID", () => {
    expect(parseAvailabilityInput({ venueId: "42", ...dates })).toEqual({
      venueId: 42,
      ...dates,
    });
  });

  it.each([
    { venueId: "VA", message: "Venue ID must be a positive integer" },
    { venueId: "2147483648", message: "Venue ID is outside the PostgreSQL integer range" },
  ])("rejects $venueId through the Zod-backed validator", ({ venueId, message }) => {
    expect(() => parseAvailabilityInput({ venueId, ...dates })).toThrow(message);
  });
});
