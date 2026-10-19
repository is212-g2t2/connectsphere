import { describe, expect, it } from "vitest";

import { windowFailureConflictKind } from "#/features/venue-requests/records.server";
import { VENUE_REQUEST_CONFLICT_LABELS } from "#/features/venue-requests/schema";

describe("PTR-135 queue conflict causes", () => {
  it("names a recorded block as blocked", () => {
    expect(
      windowFailureConflictKind({ message: "Unavailable on 2026-10-05: Floor resurfacing" })
    ).toBe("blocked");
  });

  it.each([
    "Not open 07:00–12:00 on 2026-10-05",
    "Closed or unavailable on 2026-10-05",
    "The requested window crosses midnight",
  ])("names %s as outside operating hours", message => {
    expect(windowFailureConflictKind({ message })).toBe("unavailable");
  });

  it("labels every cause without another event's name", () => {
    expect(VENUE_REQUEST_CONFLICT_LABELS).toEqual({
      booking: "Conflicting booking",
      hold: "Conflicting hold",
      blocked: "Venue blocked",
      unavailable: "Outside operating hours",
    });
  });
});
