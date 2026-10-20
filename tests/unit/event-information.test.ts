import { describe, expect, it } from "vitest";

import {
  EVENT_INFORMATION_AMENDMENTS_MESSAGE,
  EVENT_INFORMATION_COLUMNS,
  EVENT_INFORMATION_ONLY_MESSAGE,
  EVENT_REQUEST_STATUSES,
  EventRequestDraftInput,
  SIGNIFICANT_FIELDS,
  canUpdateEventInformation,
  parseEventInformationInput,
  significantFields,
} from "#/features/event-requests/schema";

describe("event information updates (PTR-22)", () => {
  it("opens only approved, planning and confirmed events to an update (AC2)", () => {
    expect(EVENT_REQUEST_STATUSES.filter(canUpdateEventInformation)).toEqual([
      "approved",
      "planning",
      "confirmed",
    ]);
  });

  it("accepts and logs every column the request form captures (AC4)", () => {
    // An update writes these columns, and the change log names them. A form column with no
    // field here accepts no update and no log entry.
    const draftColumns = Object.keys(EventRequestDraftInput.in.shape).filter(key => key !== "id");

    expect(EVENT_INFORMATION_COLUMNS.toSorted()).toEqual(draftColumns.toSorted());
  });

  it("parses the event id and the changed columns", () => {
    expect(parseEventInformationInput({ id: 7, amendments: { eventName: "Forum" } })).toEqual({
      id: 7,
      amendments: { eventName: "Forum" },
    });
  });

  it("refuses a payload without an event id or without its amendments", () => {
    expect(() => parseEventInformationInput({ amendments: {} })).toThrow("Choose an event request");
    for (const amendments of [undefined, ["eventName"], "eventName"]) {
      expect(() => parseEventInformationInput({ id: 7, amendments })).toThrow(
        EVENT_INFORMATION_AMENDMENTS_MESSAGE
      );
    }
  });

  it("refuses an amendment to anything but event information", () => {
    for (const key of ["status", "organiserId", "assignedCoordinatorId", "id", "eventname"]) {
      expect(() =>
        parseEventInformationInput({ id: 7, amendments: { eventName: "Forum", [key]: "x" } })
      ).toThrow(EVENT_INFORMATION_ONLY_MESSAGE);
    }
  });
});

describe("significant changes (PTR-23)", () => {
  it("treats the date and time, attendance, venue and equipment requirements, and layout preference as significant (AC1)", () => {
    expect([...SIGNIFICANT_FIELDS]).toEqual([
      "proposedDates",
      "expectedAttendance",
      "venueRequirements",
      "equipmentRequirements",
      "roomLayoutPreference",
    ]);
    // Accessibility requirements remain ordinary. The significant fields return in list order.
    expect(
      significantFields([
        "purpose",
        "expectedAttendance",
        "roomLayoutPreference",
        "accessibilityRequirements",
        "proposedDates",
      ])
    ).toEqual(["proposedDates", "expectedAttendance", "roomLayoutPreference"]);
  });
});
