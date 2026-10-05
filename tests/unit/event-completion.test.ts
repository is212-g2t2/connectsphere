import { describe, expect, it } from "vitest";

import {
  completionRefusal,
  completionRefusalForEvent,
  EVENT_HAS_NOT_ENDED_MESSAGE,
  NO_EVENT_END_MESSAGE,
  singaporeLocalEndHasPassed,
} from "#/features/events/completion";

const NOW = new Date("2026-10-06T00:00:00+08:00");

describe("event completion gate (PTR-25)", () => {
  it("allows a confirmed event whose end has passed", () => {
    expect(completionRefusal({ status: "confirmed", eventHasEnded: true })).toBeNull();
  });

  it("refuses a confirmed event whose end has not passed", () => {
    expect(completionRefusal({ status: "confirmed", eventHasEnded: false })).toBe(
      EVENT_HAS_NOT_ENDED_MESSAGE
    );
  });

  it("refuses a confirmed event without an end", () => {
    expect(completionRefusal({ status: "confirmed", eventHasEnded: null })).toBe(
      NO_EVENT_END_MESSAGE
    );
  });

  it("refuses every status other than confirmed", () => {
    expect(completionRefusal({ status: "approved", eventHasEnded: true })).toBe(
      "Its status is approved."
    );
    expect(completionRefusal({ status: "completed", eventHasEnded: true })).toBe(
      "Its status is completed."
    );
  });
});

describe("singaporeLocalEndHasPassed", () => {
  it.each([
    ["2020-03-10 12:30:00", true],
    ["2100-03-10T12:30", false],
    ["2020-03-10 12:30:00.000", true],
    ["2026-10-05 23:59:00", true],
    ["2026-10-06 00:01:00", false],
  ])("returns %s -> %s", (value, expected) => {
    expect(singaporeLocalEndHasPassed(value, NOW)).toBe(expected);
  });

  it.each([[null], [""], ["garbage"]])("returns null for %s", value => {
    expect(singaporeLocalEndHasPassed(value, NOW)).toBeNull();
  });
});

describe("completionRefusalForEvent", () => {
  it("allows a confirmed record with a past end", () => {
    expect(
      completionRefusalForEvent(
        {
          status: "confirmed",
          proposedDates: [{ start: "2020-03-10T09:00", end: "2020-03-10T12:30" }],
        },
        NOW
      )
    ).toBeNull();
  });

  it("refuses a confirmed record with a future end", () => {
    expect(
      completionRefusalForEvent(
        {
          status: "confirmed",
          proposedDates: [{ start: "2100-03-10T09:00", end: "2100-03-10T12:30" }],
        },
        NOW
      )
    ).toBe(EVENT_HAS_NOT_ENDED_MESSAGE);
  });

  it("refuses a confirmed record with no usable end", () => {
    expect(completionRefusalForEvent({ status: "confirmed", proposedDates: [] }, NOW)).toBe(
      NO_EVENT_END_MESSAGE
    );
  });

  it("refuses a non-confirmed record", () => {
    expect(
      completionRefusalForEvent(
        {
          status: "approved",
          proposedDates: [{ start: "2020-03-10T09:00", end: "2020-03-10T12:30" }],
        },
        NOW
      )
    ).toBe("Its status is approved.");
  });
});
