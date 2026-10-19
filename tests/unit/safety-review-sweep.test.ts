import { describe, expect, test } from "vitest";
import { hasEventStarted } from "#/features/safety-reviews/sweep.server";

describe("the first approved booking starts the event in venue-local time", () => {
  const now = new Date("2030-01-01T01:00:00Z");
  test("includes the exact start boundary", () => {
    expect(hasEventStarted([{ status: "approved", startsAt: "2030-01-01 09:00:00" }], now)).toBe(
      true
    );
    expect(hasEventStarted([{ status: "approved", startsAt: "2030-01-01 09:00:01" }], now)).toBe(
      false
    );
  });
  test("uses the earliest approved session, regardless of row order", () => {
    expect(
      hasEventStarted(
        [
          { status: "approved", startsAt: "2030-01-02 09:00:00" },
          { status: "approved", startsAt: "2029-12-31 09:00:00" },
        ],
        now
      )
    ).toBe(true);
  });
  test("ignores released and pending bookings", () => {
    expect(
      hasEventStarted(
        [
          { status: "released", startsAt: "2029-12-31 09:00:00" },
          { status: "pending", startsAt: "2029-12-31 09:00:00" },
        ],
        now
      )
    ).toBe(false);
  });
});
