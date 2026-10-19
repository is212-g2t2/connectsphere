import { describe, expect, it } from "vitest";

import { adjustableRejectionIds } from "#/features/venue-requests/records.server";
import type { VenueRequestStatus } from "#/features/venue-requests/schema";

const DISMISSED_AT = new Date("2027-04-02T00:00:00Z");

/** One row of the event with the fields that the replacement chain reads. */
function request(
  id: string,
  status: VenueRequestStatus,
  options: { replacesRequestId?: string; dismissedAt?: Date } = {}
) {
  return {
    id,
    status,
    replacesRequestId: options.replacesRequestId ?? null,
    dismissedAt: options.dismissedAt ?? null,
  };
}

/** A three-row chain: `first` is replaced by `second`, and `second` by `third`. */
function chain(end: VenueRequestStatus) {
  return [
    request("first", "rejected"),
    request("second", "rejected", { replacesRequestId: "first" }),
    request("third", end, { replacesRequestId: "second" }),
  ];
}

describe("adjustableRejectionIds (PTR-35, PTR-165 AC5)", () => {
  it("marks a rejected row with no replacement", () => {
    expect(adjustableRejectionIds([request("rejected", "rejected")])).toEqual(
      new Set(["rejected"])
    );
  });

  it.each(["pending", "approved", "released", "withdrawn"] as const)(
    "never marks a %s row",
    status => {
      expect(adjustableRejectionIds([request("row", status)])).toEqual(new Set());
    }
  );

  it.each(["approved", "pending"] as const)(
    "drops the mark once a %s replacement answers the rejection",
    status => {
      const rows = [
        request("rejected", "rejected"),
        request("new", status, { replacesRequestId: "rejected" }),
      ];

      expect(adjustableRejectionIds(rows)).toEqual(new Set());
    }
  );

  it("keeps the mark when the replacement was withdrawn", () => {
    const rows = [
      request("rejected", "rejected"),
      request("new", "withdrawn", { replacesRequestId: "rejected" }),
    ];

    expect(adjustableRejectionIds(rows)).toEqual(new Set(["rejected"]));
  });

  it("decides a chain by its last request", () => {
    expect(adjustableRejectionIds(chain("approved"))).toEqual(new Set());
    expect(adjustableRejectionIds(chain("pending"))).toEqual(new Set());
    // The chain ends at the third rejection, which no replacement answers yet, so only it is left
    // to adjust: the first two already have a live replacement (PTR-165 AC5, AC6).
    expect(adjustableRejectionIds(chain("rejected"))).toEqual(new Set(["third"]));
  });

  it("keeps the mark when a later request does not name the rejection", () => {
    const rows = [request("rejected", "rejected"), request("new", "approved")];

    expect(adjustableRejectionIds(rows)).toEqual(new Set(["rejected"]));
  });

  it("drops the mark when the Coordinator dismissed the rejection", () => {
    const rows = [request("rejected", "rejected", { dismissedAt: DISMISSED_AT })];

    expect(adjustableRejectionIds(rows)).toEqual(new Set());
  });

  it("keeps the mark when the live replacer is itself replaced (PTR-165 AC2)", () => {
    const rows = [
      request("first", "rejected"),
      request("approved-mid", "approved", { replacesRequestId: "first" }),
      request("end", "rejected", { replacesRequestId: "approved-mid" }),
    ];

    // The chain ends at a rejected request, so `first` is unanswered, and it already has a live
    // replacer. Only the chain's end is left to adjust.
    expect(adjustableRejectionIds(rows)).toEqual(new Set(["end"]));
  });

  it("decides each rejected row on its own", () => {
    const rows = [
      request("first", "rejected"),
      request("second", "rejected"),
      request("replacement", "approved", { replacesRequestId: "second" }),
    ];

    expect(adjustableRejectionIds(rows)).toEqual(new Set(["first"]));
  });
});
