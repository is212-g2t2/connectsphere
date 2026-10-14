import { describe, expect, it } from "vitest";

import { rethrowVenueConflict, suspensionValues } from "#/features/venue-requests/occupancy.server";
import {
  venueRequestEventStatusMessage,
  venueRequirementsMessage,
  venueUnavailableMessage,
} from "#/features/venue-requests/requests.server";
import {
  VENUE_CONFLICT_PHRASES,
  VENUE_OCCUPANCY_CONFLICT_MESSAGE,
  isVenueConflictMessage,
  venueBlockConflictMessage,
} from "#/features/venue-requests/schema";

/** Drizzle wraps the driver error in `cause`, as `isConstraintViolation` expects. */
function driverError(cause: Record<string, string>) {
  return new Error("Failed query", { cause });
}

const conflict = { name: "ConflictError", status: 409, message: VENUE_OCCUPANCY_CONFLICT_MESSAGE };

/** A block extent for the pure suspension math. */
function block(startsAt: string, endsAt: string | null) {
  return { venueId: 1, startsAt, endsAt };
}

/** An absolute suspension piece with buffers 0. */
function piece(startsAt: string, endsAt: string, active: boolean) {
  return { startsAt, endsAt, setupMinutes: 0, turnaroundMinutes: 0, active };
}

describe("rethrowVenueConflict (PTR-133 AC3)", () => {
  it.each([
    [
      "an exclusion violation from node-postgres",
      { code: "23P01", constraint: "venue_occupancy_no_overlap" },
    ],
    ["a deadlock from node-postgres", { code: "40P01" }],
    // Bun SQL reports a deadlock in this shape (captured from postgres:18).
    ["a deadlock from Bun SQL", { code: "ERR_POSTGRES_SERVER_ERROR", errno: "40P01" }],
  ])("maps %s to the venue-conflict refusal", (_, cause) => {
    expect(() => rethrowVenueConflict(driverError(cause))).toThrow(
      expect.objectContaining(conflict)
    );
  });

  it("answers a message that the approve button shows as a venue conflict", () => {
    expect(isVenueConflictMessage(VENUE_OCCUPANCY_CONFLICT_MESSAGE)).toBe(true);
    // PTR-138: the approve button shows the other approval refusals that name a reason too.
    expect(
      isVenueConflictMessage(venueRequirementsMessage("Room B", ["Holds 40; 80 needed"]))
    ).toBe(true);
    expect(isVenueConflictMessage(venueRequestEventStatusMessage("confirmed"))).toBe(true);
    expect(
      isVenueConflictMessage(
        venueUnavailableMessage("Room B", "Not open 07:00–09:00 on 2027-04-20")
      )
    ).toBe(true);
  });

  it("rethrows any other error unchanged", () => {
    const duplicate = driverError({ code: "23505", constraint: "venue_occupancy_pkey" });
    expect(() => rethrowVenueConflict(duplicate)).toThrow(duplicate);
    const plain = new Error("connection reset");
    expect(() => rethrowVenueConflict(plain)).toThrow(plain);
  });
});

describe("venueBlockConflictMessage (PTR-136)", () => {
  it("names a finite block with the block phrase", () => {
    expect(
      venueBlockConflictMessage({
        venueName: "Harbour Hall",
        startsAt: "2027-06-01T09:00:00",
        endsAt: "2027-06-01T12:30:00",
      })
    ).toBe("Harbour Hall is unavailable 1 Jun 2027, 09:00 – 12:30");
  });

  it("renders a null end as until lifted, never year 9999", () => {
    const message = venueBlockConflictMessage({
      venueName: "Harbour Hall",
      startsAt: "2027-06-01 09:00:00",
      endsAt: null,
    });
    expect(message).toBe("Harbour Hall is unavailable from 1 Jun 2027, 09:00 until lifted");
    expect(message).not.toContain("9999");
  });

  it("lists the block phrase so the approve button shows it verbatim", () => {
    expect(VENUE_CONFLICT_PHRASES).toContain("unavailable");
    expect(
      isVenueConflictMessage(
        venueBlockConflictMessage({
          venueName: "Harbour Hall",
          startsAt: "2027-06-01T09:00:00",
          endsAt: "2027-06-01T12:30:00",
        })
      )
    ).toBe(true);
    expect(
      isVenueConflictMessage(
        venueBlockConflictMessage({
          venueName: "Harbour Hall",
          startsAt: "2027-06-01T09:00:00",
          endsAt: null,
        })
      )
    ).toBe(true);
  });
});

describe("suspensionValues (PTR-136)", () => {
  // A booking 10:00 to 12:00 with 30/45 buffers occupies 09:30 to 12:45.
  const row = {
    startsAt: "2027-06-01 10:00:00",
    endsAt: "2027-06-01 12:00:00",
    setupMinutes: 30,
    turnaroundMinutes: 45,
    active: true,
  };

  it("keeps a row clear of every block unchanged", () => {
    expect(suspensionValues(row, [block("2027-06-01 13:00:00", "2027-06-01 14:00:00")])).toEqual([
      row,
    ]);
  });

  it("deactivates a fully covered row and keeps its stored buffers", () => {
    expect(suspensionValues(row, [block("2027-06-01 09:30:00", "2027-06-01 12:45:00")])).toEqual([
      { ...row, active: false },
    ]);
  });

  it("splits a partial cover on the occupied extent, buffers 0", () => {
    expect(suspensionValues(row, [block("2027-06-01 11:00:00", "2027-06-01 12:00:00")])).toEqual([
      piece("2027-06-01 11:00:00", "2027-06-01 12:00:00", false),
      piece("2027-06-01 09:30:00", "2027-06-01 11:00:00", true),
      piece("2027-06-01 12:00:00", "2027-06-01 12:45:00", true),
    ]);
  });

  it("splits when only the turnaround buffer reaches the block", () => {
    expect(suspensionValues(row, [block("2027-06-01 12:30:00", "2027-06-01 13:00:00")])).toEqual([
      piece("2027-06-01 12:30:00", "2027-06-01 12:45:00", false),
      piece("2027-06-01 09:30:00", "2027-06-01 12:30:00", true),
    ]);
  });

  it("treats an unbounded block as open to the right", () => {
    expect(suspensionValues(row, [block("2027-06-01 11:00:00", null)])).toEqual([
      piece("2027-06-01 11:00:00", "2027-06-01 12:45:00", false),
      piece("2027-06-01 09:30:00", "2027-06-01 11:00:00", true),
    ]);
  });

  it("applies several blocks in turn and leaves inactive values alone", () => {
    const once = suspensionValues(row, [block("2027-06-01 10:00:00", "2027-06-01 10:30:00")]);
    expect(
      suspensionValues(row, [
        block("2027-06-01 10:00:00", "2027-06-01 10:30:00"),
        block("2027-06-01 11:00:00", "2027-06-01 11:30:00"),
        block("2027-06-01 10:15:00", "2027-06-01 10:20:00"),
      ])
    ).toEqual([
      piece("2027-06-01 10:00:00", "2027-06-01 10:30:00", false),
      piece("2027-06-01 09:30:00", "2027-06-01 10:00:00", true),
      piece("2027-06-01 11:00:00", "2027-06-01 11:30:00", false),
      piece("2027-06-01 10:30:00", "2027-06-01 11:00:00", true),
      piece("2027-06-01 11:30:00", "2027-06-01 12:45:00", true),
    ]);
    expect(once).toHaveLength(3);
  });
});
