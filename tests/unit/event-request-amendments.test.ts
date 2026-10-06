import { describe, expect, it } from "vitest";

import type { eventRequests } from "#/db/schema";
import {
  amendedValues,
  amendmentsBetween,
  pickAmendments,
} from "#/features/event-requests/amendments";
import { CLARIFICATION_FIELDS } from "#/features/event-requests/schema";

const ALL_FIELDS = CLARIFICATION_FIELDS.map(field => field.key);

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
  registrationEnabled: true,
  registrationCapacity: 50,
  registrationOpensAt: "2031-02-01T09:00",
  registrationClosesAt: "2031-03-01T17:00",
  status: "approved",
} as unknown as typeof eventRequests.$inferSelect;

describe("event request amendments", () => {
  it("finds no change when only the key order or an absent value's spelling differs", () => {
    const values = amendedValues(row, {
      proposedDates: [{ end: "2031-03-10T17:00", start: "2031-03-10T09:00" }],
      equipmentRequirements: [{ quantity: 1, type: "Projector" }],
    });

    expect(amendmentsBetween(row, values, ALL_FIELDS)).toEqual([]);
  });

  it("names each changed field once, with the stored and the new value", () => {
    const values = amendedValues(row, { eventName: "Regional forum", expectedAttendance: 90 });

    expect(amendmentsBetween(row, values, ALL_FIELDS)).toEqual([
      { field: "eventName", from: "Planning forum", to: "Regional forum" },
      { field: "expectedAttendance", from: 80, to: 90 },
    ]);
    expect(amendmentsBetween(row, values, ["purpose", "eventName", "eventName"])).toEqual([
      { field: "eventName", from: "Planning forum", to: "Regional forum" },
    ]);
  });

  it("groups the four registration columns into one change", () => {
    const values = amendedValues(row, { registrationCapacity: 60 });

    expect(amendmentsBetween(row, values, ALL_FIELDS)).toEqual([
      {
        field: "attendeeRegistration",
        from: {
          registrationCapacity: 50,
          registrationClosesAt: "2031-03-01T17:00",
          registrationEnabled: true,
          registrationOpensAt: "2031-02-01T09:00",
        },
        to: {
          registrationCapacity: 60,
          registrationClosesAt: "2031-03-01T17:00",
          registrationEnabled: true,
          registrationOpensAt: "2031-02-01T09:00",
        },
      },
    ]);
  });

  it("keeps the stored value of a column the amendments leave out, and drops non-draft keys", () => {
    const values = amendedValues(row, { purpose: "Agree two plans", status: "completed" });

    expect(values).toMatchObject({ eventName: "Planning forum", purpose: "Agree two plans" });
    expect(values).not.toHaveProperty("status");
  });

  it("refuses amendments that leave a field a submitted event needs empty", () => {
    expect(() => amendedValues(row, { expectedAttendance: null, purpose: "" })).toThrow(
      "This request is missing: Purpose, Expected attendance"
    );
  });

  it("picks only the touched fields, and all four registration columns together", () => {
    const values = amendedValues(row, {});

    expect(pickAmendments(values, ALL_FIELDS, [])).toEqual({});
    expect(
      pickAmendments({ ...values, eventName: "Regional forum" }, ALL_FIELDS, [
        "eventName",
        "registrationCapacity",
      ])
    ).toEqual({
      eventName: "Regional forum",
      registrationEnabled: true,
      registrationCapacity: 50,
      registrationOpensAt: "2031-02-01T09:00",
      registrationClosesAt: "2031-03-01T17:00",
    });
  });
});
