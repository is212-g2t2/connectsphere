import { describe, expect, it } from "vitest";

import type { eventRequests } from "#/db/schema";
import { amendedValues, amendmentsBetween } from "#/features/event-requests/amendments";
import { EVENT_INFORMATION_FIELDS } from "#/features/event-requests/schema";

/** A stored row as the handlers lock it; only the draft columns matter to these helpers. */
const row = {
  id: 7,
  eventName: "Planning forum",
  purpose: "Agree the plan",
  proposedDates: [{ start: "2031-03-10T09:00", end: "2031-03-10T17:00" }],
  expectedAttendance: 80,
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  equipmentRequirements: [{ type: "Projector", quantity: 1 }],
  specialArrangements: "",
  registrationEnabled: false,
  registrationCapacity: null,
  registrationOpensAt: null,
  registrationClosesAt: null,
} as unknown as typeof eventRequests.$inferSelect;

describe("event request amendments", () => {
  it("finds no change when only the key order or an absent value's spelling differs", () => {
    // `jsonb` stores keys in its own order, and the row stores absent terms as null where the
    // parsed values carry them as undefined.
    const values = amendedValues(row, {
      proposedDates: [{ end: "2031-03-10T17:00", start: "2031-03-10T09:00" }],
      equipmentRequirements: [{ quantity: 1, type: "Projector" }],
      registrationCapacity: null,
    });

    expect(values.registrationCapacity).toBeUndefined();
    expect(amendmentsBetween(row, values, EVENT_INFORMATION_FIELDS)).toEqual([]);
  });

  it("names a field once, however often the list repeats it", () => {
    const values = amendedValues(row, { eventName: "Regional forum" });

    expect(amendmentsBetween(row, values, ["eventName", "purpose", "eventName"])).toEqual([
      { field: "eventName", from: "Planning forum", to: "Regional forum" },
    ]);
  });
});
