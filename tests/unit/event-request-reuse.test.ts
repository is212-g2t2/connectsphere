import { describe, expect, it } from "vitest";

import {
  canReuseEventRequest,
  EVENT_REQUEST_REUSE_REFUSAL,
} from "#/features/event-requests/schema";

describe("reuse gate (PTR-154)", () => {
  it("refuses a draft even when its event date has passed", () => {
    expect(canReuseEventRequest("draft", true)).toBe(false);
    expect(canReuseEventRequest("draft", false)).toBe(false);
  });

  it("allows a completed request with any event date", () => {
    expect(canReuseEventRequest("completed", true)).toBe(true);
    expect(canReuseEventRequest("completed", false)).toBe(true);
  });

  it("allows a non-draft request whose event date has passed", () => {
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
      expect(canReuseEventRequest(status, true)).toBe(true);
    }
  });

  it("refuses a live request whose event date has not passed", () => {
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
      expect(canReuseEventRequest(status, false)).toBe(false);
    }
  });

  it("names the refusal for the server to throw", () => {
    expect(EVENT_REQUEST_REUSE_REFUSAL).toContain("event date has passed");
  });
});
