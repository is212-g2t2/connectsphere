import { describe, expect, it } from "vitest";

import { EVENT_REQUEST_REUSE_REFUSAL } from "#/features/event-requests/schema";
import { isReusableEventRequest } from "#/features/event-requests/reuse";

describe("reuse eligibility (PTR-154)", () => {
  const now = new Date("2026-10-23T00:00:00+08:00");
  const past = [{ start: "2026-10-22T10:00", end: "2026-10-22T12:00" }];
  const future = [{ start: "2026-10-24T10:00", end: "2026-10-24T12:00" }];

  it("allows a completed request with or without dates", () => {
    expect(isReusableEventRequest({ status: "completed", proposedDates: [] }, now)).toBe(true);
    expect(isReusableEventRequest({ status: "completed", proposedDates: past }, now)).toBe(true);
  });

  it("allows a non-draft request only once its proposed end has passed", () => {
    for (const status of [
      "submitted",
      "under_review",
      "awaiting_organiser",
      "approved",
      "planning",
      "confirmed",
      "rejected",
      "cancelled",
    ] as const) {
      expect(isReusableEventRequest({ status, proposedDates: past }, now)).toBe(true);
      expect(isReusableEventRequest({ status, proposedDates: future }, now)).toBe(false);
    }
  });

  it("refuses a draft and a non-draft request without a usable end", () => {
    expect(isReusableEventRequest({ status: "draft", proposedDates: [] }, now)).toBe(false);
    expect(isReusableEventRequest({ status: "approved", proposedDates: [] }, now)).toBe(false);
    expect(
      isReusableEventRequest(
        { status: "approved", proposedDates: [{ start: "2026-10-22T10:00" }] },
        now
      )
    ).toBe(false);
  });

  it("names the refusal for the server to throw", () => {
    expect(EVENT_REQUEST_REUSE_REFUSAL).toContain("event date has passed");
  });
});
