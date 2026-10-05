import { describe, expect, it } from "vitest";

import {
  EVENT_HAS_NOT_ENDED_MESSAGE,
  NO_APPROVED_BOOKING_MESSAGE,
} from "#/features/events/completion";
import { completionRefusal } from "#/features/events/complete.server";

describe("event completion gate (PTR-25)", () => {
  it("allows only a confirmed event whose approved booking has ended", () => {
    expect(completionRefusal({ status: "confirmed", approvedBookingHasEnded: true })).toBeNull();
  });

  it("refuses every status other than confirmed", () => {
    expect(completionRefusal({ status: "approved", approvedBookingHasEnded: true })).toBe(
      "Its status is approved."
    );
    expect(completionRefusal({ status: "completed", approvedBookingHasEnded: true })).toBe(
      "Its status is completed."
    );
  });

  it("refuses a confirmed event without one approved booking", () => {
    expect(completionRefusal({ status: "confirmed", approvedBookingHasEnded: null })).toBe(
      NO_APPROVED_BOOKING_MESSAGE
    );
  });

  it("refuses a confirmed event before its approved booking ends", () => {
    expect(completionRefusal({ status: "confirmed", approvedBookingHasEnded: false })).toBe(
      EVENT_HAS_NOT_ENDED_MESSAGE
    );
  });
});
