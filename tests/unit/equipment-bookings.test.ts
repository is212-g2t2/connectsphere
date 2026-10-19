import { describe, expect, it } from "vitest";

import { chooseEquipmentBooking } from "#/features/equipment-requests/bookings.server";

const morning = { id: "morning", suspended: false };
const afternoon = { id: "afternoon", suspended: false };
const suspended = { id: "suspended", suspended: true };

describe("equipment booking choice", () => {
  it("uses the only active booking when no choice is needed", () => {
    expect(chooseEquipmentBooking([morning, suspended])).toBe(morning);
  });

  it("requires a choice among several active sessions", () => {
    expect(() => chooseEquipmentBooking([morning, afternoon])).toThrow("Choose an active");
    expect(chooseEquipmentBooking([morning, afternoon], afternoon.id)).toBe(afternoon);
  });

  it.each(["suspended", "another-event", "released"])("refuses target %s", id => {
    expect(() => chooseEquipmentBooking([morning, suspended], id)).toThrow("Choose an active");
  });

  it("refuses an event with no active approved booking", () => {
    expect(() => chooseEquipmentBooking([])).toThrow("approved venue booking");
    expect(() => chooseEquipmentBooking([suspended])).toThrow("approved venue booking");
  });
});
