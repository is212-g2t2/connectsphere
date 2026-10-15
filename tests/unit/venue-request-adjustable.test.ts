import { describe, expect, it } from "vitest";

import { adjustableRejectionIds } from "#/features/venue-requests/records.server";
import type { VenueRequestStatus } from "#/features/venue-requests/schema";

const HALL = 1;
const ROOM = 2;
const REJECTED_AT = new Date("2027-04-02T00:00:00Z");
const BEFORE = new Date("2027-04-01T00:00:00Z");
const AFTER = new Date("2027-04-03T00:00:00Z");

/** A rejected row at the hall, rejected at `REJECTED_AT`. */
function rejection(overrides: { id?: string; suggestedVenueId?: number } = {}) {
  return {
    id: overrides.id ?? "rejected",
    status: "rejected" as const,
    venueId: HALL,
    suggestedVenueId: overrides.suggestedVenueId ?? null,
    createdAt: BEFORE,
    updatedAt: REJECTED_AT,
  };
}

/** Another row of the same event. */
function request(id: string, status: VenueRequestStatus, venueId: number, createdAt: Date) {
  return { id, status, venueId, suggestedVenueId: null, createdAt, updatedAt: createdAt };
}

describe("adjustableRejectionIds (PTR-35, PTR-138)", () => {
  it("marks a rejected row with no newer request at its venue", () => {
    expect(adjustableRejectionIds([rejection()])).toEqual(new Set(["rejected"]));
  });

  it("never marks a row in another state", () => {
    const rows = (["pending", "approved", "released", "withdrawn"] as const).map(status =>
      request(status, status, HALL, BEFORE)
    );

    expect(adjustableRejectionIds(rows)).toEqual(new Set());
  });

  it.each(["pending", "approved", "rejected", "released"] as const)(
    "drops the mark once a newer %s request exists at the rejected venue",
    status => {
      const marked = adjustableRejectionIds([rejection(), request("newer", status, HALL, AFTER)]);

      expect(marked.has("rejected")).toBe(false);
    }
  );

  it("keeps the mark beside a newer withdrawn request at the venue", () => {
    const rows = [rejection(), request("withdrawn", "withdrawn", HALL, AFTER)];

    expect(adjustableRejectionIds(rows)).toEqual(new Set(["rejected"]));
  });

  it("keeps the mark beside a newer request at another venue", () => {
    const rows = [rejection(), request("room", "approved", ROOM, AFTER)];

    expect(adjustableRejectionIds(rows)).toEqual(new Set(["rejected"]));
  });

  it("keeps the mark beside a request created before or at the rejection", () => {
    const rows = [
      rejection(),
      request("older", "pending", HALL, BEFORE),
      request("same-time", "pending", HALL, REJECTED_AT),
    ];

    expect(adjustableRejectionIds(rows)).toEqual(new Set(["rejected"]));
  });

  it("targets the suggested venue when Venue Staff suggested one", () => {
    const suggested = rejection({ suggestedVenueId: ROOM });

    // A newer request at the rejected venue does not answer a suggestion for another venue.
    expect(adjustableRejectionIds([suggested, request("hall", "pending", HALL, AFTER)])).toEqual(
      new Set(["rejected"])
    );
    expect(adjustableRejectionIds([suggested, request("room", "pending", ROOM, AFTER)])).toEqual(
      new Set()
    );
  });

  it("decides each rejected row on its own", () => {
    const rows = [
      rejection({ id: "first" }),
      { ...rejection({ id: "second" }), createdAt: AFTER, updatedAt: AFTER },
    ];

    // The second rejection is a newer request at the hall, so only it stays adjustable.
    expect(adjustableRejectionIds(rows)).toEqual(new Set(["second"]));
  });
});
