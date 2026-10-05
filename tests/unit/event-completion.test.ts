import { describe, expect, it } from "vitest";

import {
  completionRefusal,
  EVENT_HAS_NOT_ENDED_MESSAGE,
  NO_EVENT_END_MESSAGE,
} from "#/features/events/completion";

describe("event completion gate (PTR-25)", () => {
  it("allows only a confirmed event whose approved booking has ended", () => {
    expect(
      completionRefusal({
        status: "confirmed",
        approvedBookingHasEnded: true,
        eventHasEnded: false,
      })
    ).toBeNull();
  });

  it("falls back to the event end after its approved booking is released", () => {
    expect(
      completionRefusal({
        status: "confirmed",
        approvedBookingHasEnded: null,
        eventHasEnded: true,
      })
    ).toBeNull();
  });

  it("refuses every status other than confirmed", () => {
    expect(
      completionRefusal({
        status: "approved",
        approvedBookingHasEnded: true,
        eventHasEnded: true,
      })
    ).toBe("Its status is approved.");
    expect(
      completionRefusal({
        status: "completed",
        approvedBookingHasEnded: true,
        eventHasEnded: true,
      })
    ).toBe("Its status is completed.");
  });

  it("refuses a confirmed event without a booking or event end", () => {
    expect(
      completionRefusal({
        status: "confirmed",
        approvedBookingHasEnded: null,
        eventHasEnded: null,
      })
    ).toBe(NO_EVENT_END_MESSAGE);
  });

  it("refuses a confirmed event before its approved booking ends", () => {
    expect(
      completionRefusal({
        status: "confirmed",
        approvedBookingHasEnded: false,
        eventHasEnded: true,
      })
    ).toBe(EVENT_HAS_NOT_ENDED_MESSAGE);
  });
});
