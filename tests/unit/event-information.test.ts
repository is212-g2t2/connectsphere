import { describe, expect, it } from "vitest";

import {
  CLARIFICATION_FIELDS,
  EVENT_REQUEST_STATUSES,
  EventRequestDraftInput,
  canUpdateEventInformation,
  clarificationAmendmentKeys,
  parseEventInformationInput,
} from "#/features/event-requests/schema";

describe("event information updates (PTR-22)", () => {
  it("opens only approved, planning and confirmed events to an update (AC2)", () => {
    expect(EVENT_REQUEST_STATUSES.filter(canUpdateEventInformation)).toEqual([
      "approved",
      "planning",
      "confirmed",
    ]);
  });

  it("logs a change for every column an update can write (AC4)", () => {
    // The handler saves every draft column and logs the `CLARIFICATION_FIELDS` that differ. A
    // column added to the form without a field here would be saved and never logged.
    const draftColumns = Object.keys(EventRequestDraftInput.in.shape).filter(key => key !== "id");
    const loggedColumns = CLARIFICATION_FIELDS.flatMap(field =>
      clarificationAmendmentKeys(field.key)
    );

    expect(loggedColumns.toSorted()).toEqual(draftColumns.toSorted());
  });

  it("parses the event id and the changed columns", () => {
    expect(parseEventInformationInput({ id: 7, amendments: { eventName: "Forum" } })).toEqual({
      id: 7,
      amendments: { eventName: "Forum" },
    });
  });

  it("refuses a payload without an event id or without its amendments", () => {
    expect(() => parseEventInformationInput({ amendments: {} })).toThrow("Choose an event request");
    expect(() => parseEventInformationInput({ id: 7 })).toThrow(/expected record/);
    expect(() => parseEventInformationInput({ id: 7, amendments: ["eventName"] })).toThrow(
      /expected record/
    );
  });
});
