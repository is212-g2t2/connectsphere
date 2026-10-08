import { describe, expect, it } from "vitest";

import {
  CLARIFICATION_FIELDS,
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
    // An update may write these columns and the change log names them. A column added to the form
    // without a field here could not be updated, and would never be logged.
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
  it("treats the date and time, expected attendance, venue requirements and equipment requirements as significant, and every other field as ordinary (AC1)", () => {
    expect([...SIGNIFICANT_FIELDS]).toEqual([
      "proposedDates",
      "expectedAttendance",
      "venueRequirements",
      "equipmentRequirements",
    ]);
    const ordinary = CLARIFICATION_FIELDS.map(field => field.key).filter(
      field => !SIGNIFICANT_FIELDS.some(significant => significant === field)
    );
    expect(ordinary).toEqual([
      "eventName",
      "purpose",
      "description",
      "eventType",
      "roomLayoutPreference",
      "accessibilityRequirements",
      "specialArrangements",
      "attendeeRegistration",
    ]);
    expect(significantFields(ordinary)).toEqual([]);
  });

  it("picks the significant fields out of a save, in a fixed order, and ignores names it does not know", () => {
    expect(significantFields(["purpose", "expectedAttendance", "proposedDates"])).toEqual([
      "proposedDates",
      "expectedAttendance",
    ]);
    expect(significantFields(["registrationCapacity", "replyBody", "status"])).toEqual([]);
    expect(significantFields([])).toEqual([]);
  });

  it("accepts the acknowledgement beside the amendments, and nothing else (AC2)", () => {
    expect(
      parseEventInformationInput({
        id: 7,
        amendments: { expectedAttendance: 120 },
        acknowledgeSignificant: true,
      })
    ).toEqual({ id: 7, amendments: { expectedAttendance: 120 }, acknowledgeSignificant: true });
    expect(
      parseEventInformationInput({ id: 7, amendments: {}, acknowledgeSignificant: undefined })
    ).toEqual({ id: 7, amendments: {} });
    expect(() =>
      parseEventInformationInput({ id: 7, amendments: {}, acknowledgeSignificant: "yes" })
    ).toThrow(/boolean/u);
  });
});
