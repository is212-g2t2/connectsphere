import { describe, expect, it } from "vitest";

import {
  ARRANGEMENT_EMPTY_UPDATE_MESSAGE,
  ARRANGEMENT_REASON_MESSAGE,
  ARRANGEMENT_STATE_MESSAGE,
  ARRANGEMENT_STATES,
  EQUIPMENT_NOTES_MAX,
  EQUIPMENT_NOTES_MESSAGE,
  parseArrangementUpdateInput,
} from "#/features/equipment-requests/schema";

const line = { eventId: 7, id: "line-1" };

describe("parseArrangementUpdateInput (PTR-39 AC3)", () => {
  it("accepts requested, not required and unavailable", () => {
    expect(ARRANGEMENT_STATES).toEqual(["requested", "not_required", "unavailable"]);

    expect(parseArrangementUpdateInput({ ...line, arrangementStatus: "requested" })).toEqual({
      ...line,
      arrangementStatus: "requested",
    });
    expect(parseArrangementUpdateInput({ ...line, arrangementStatus: "not_required" })).toEqual({
      ...line,
      arrangementStatus: "not_required",
    });
    expect(
      parseArrangementUpdateInput({
        ...line,
        arrangementStatus: "unavailable",
        unavailableReason: "Loaned out",
      })
    ).toEqual({ ...line, arrangementStatus: "unavailable", unavailableReason: "Loaned out" });
  });

  it("requires a reason for unavailable", () => {
    expect(() =>
      parseArrangementUpdateInput({ ...line, arrangementStatus: "unavailable" })
    ).toThrow(ARRANGEMENT_REASON_MESSAGE);
  });

  it("refuses a blank or whitespace reason", () => {
    for (const unavailableReason of ["", "   ", "\n\t "]) {
      expect(() =>
        parseArrangementUpdateInput({
          ...line,
          arrangementStatus: "unavailable",
          unavailableReason,
        })
      ).toThrow(ARRANGEMENT_REASON_MESSAGE);
    }
  });

  it("does not accept reserved as a state to set", () => {
    // Reserved belongs to the reservation action (PTR-41); an update can never write it.
    expect(() => parseArrangementUpdateInput({ ...line, arrangementStatus: "reserved" })).toThrow(
      ARRANGEMENT_STATE_MESSAGE
    );
    expect(ARRANGEMENT_STATES).not.toContain("reserved");
  });

  it("trims notes and refuses notes over the limit", () => {
    expect(
      parseArrangementUpdateInput({ ...line, arrangementNotes: "  Adapter in store B  " })
    ).toEqual({ ...line, arrangementNotes: "Adapter in store B" });
    // An empty note is how a note is cleared, so it survives parsing as an empty string.
    expect(parseArrangementUpdateInput({ ...line, arrangementNotes: "   " })).toEqual({
      ...line,
      arrangementNotes: "",
    });
    expect(() =>
      parseArrangementUpdateInput({
        ...line,
        arrangementNotes: "x".repeat(EQUIPMENT_NOTES_MAX + 1),
      })
    ).toThrow(EQUIPMENT_NOTES_MESSAGE);
  });

  it("refuses an update that changes neither state nor notes", () => {
    expect(() => parseArrangementUpdateInput(line)).toThrow(ARRANGEMENT_EMPTY_UPDATE_MESSAGE);
  });
});
