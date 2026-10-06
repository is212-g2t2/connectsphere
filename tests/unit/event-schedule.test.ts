import { describe, expect, it } from "vitest";

import { eventSchedule } from "#/features/events/schedule";

function venue(date: string, endDate: string) {
  return {
    name: "Test Hall",
    location: "Level 1",
    date,
    endDate,
    startTime: "22:00",
    endTime: "02:00",
  };
}

describe("eventSchedule", () => {
  it("recognizes an overnight booking", () => {
    expect(
      eventSchedule({
        eventDate: "2030-01-01",
        startTime: "09:00",
        endTime: "17:00",
        venue: venue("2030-01-01", "2030-01-02"),
      }).crossesMidnight
    ).toBe(true);
  });

  it.each([
    ["a same-day booking", "2030-01-01", "2030-01-01"],
    ["a longer booking", "2030-01-01", "2030-01-03"],
    ["a malformed date", "not-a-date", "2030-01-02"],
    ["an invalid calendar date", "2030-99-99", "2030-99-99"],
  ])("does not mark %s as an overnight booking", (_label, date, endDate) => {
    expect(
      eventSchedule({
        eventDate: null,
        startTime: null,
        endTime: null,
        venue: venue(date, endDate),
      }).crossesMidnight
    ).toBe(false);
  });
});
