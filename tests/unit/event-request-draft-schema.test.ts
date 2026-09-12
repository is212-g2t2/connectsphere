import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_MESSAGE,
  END_BEFORE_START_MESSAGE,
  EQUIPMENT_QUANTITY_MESSAGE,
  EVENT_NAME_MAX_LENGTH,
  EVENT_NAME_MESSAGE,
  EventRequestDraftFormInput,
  EventRequestDraftInput,
  PURPOSE_MAX_LENGTH,
  PURPOSE_MESSAGE,
  missingRequiredFields,
  parseDraftInput,
} from "#/features/event-requests/schema";

const BLANK_DRAFT = {
  eventName: "",
  purpose: "",
  proposedDates: [],
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  equipmentRequirements: [],
  specialArrangements: "",
};

const BLANK_FORM = {
  eventName: "",
  purpose: "",
  proposedDates: [{ key: "1", start: "", end: "" }],
  expectedAttendance: "",
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  equipmentRequirements: [],
  specialArrangements: "",
};

describe("EventRequestDraftInput", () => {
  it("saves an entirely blank draft", () => {
    expect(EventRequestDraftInput.parse({})).toEqual(BLANK_DRAFT);
  });

  it("keeps every supplied field exactly as entered", () => {
    const values = {
      eventName: "  Community workshop  ",
      purpose: "Meet neighbours\n  Plan next steps  ",
      proposedDates: [
        { start: "2026-10-12T14:30", end: "2026-10-12T18:45" },
        { start: "2026-10-10T09:00", end: "2026-10-11T00:15" },
      ],
      expectedAttendance: 25,
      description: "  First line\nSecond line  ",
      eventType: " Workshop / Q&A ",
      venueRequirements: "  Near MRT\nGround floor ",
      roomLayoutPreference: " U-shape  ",
      accessibilityRequirements: "  Step-free access ",
      equipmentRequirements: [
        { type: "  Wireless microphone ", quantity: 2 },
        { type: "Projector", quantity: 1 },
      ],
      specialArrangements: "  Quiet room\nDietary options  ",
    };

    expect(EventRequestDraftInput.parse(values)).toEqual(values);
  });

  it("allows a date line with only one side filled", () => {
    const parsed = EventRequestDraftInput.parse({
      proposedDates: [{ start: "2026-10-10T09:00" }, { end: "2026-10-11T17:00" }],
    });

    expect(parsed.proposedDates).toEqual([
      { start: "2026-10-10T09:00" },
      { end: "2026-10-11T17:00" },
    ]);
  });

  it.each([
    "2026-02-30T09:30",
    "2026-04-31T09:30",
    "2026-13-01T09:30",
    "2026-11-18",
    "2026-11-18T24:00",
    "2026-11-18T09:60",
    // Accepted by a bare ISO check; refused because `datetime-local` submits no seconds, and the
    // stored precision is what the range comparison is validated against.
    "2026-11-18T09:30:15",
    "2026-11-18T09:30Z",
  ])("refuses the malformed proposed date %s", value => {
    const result = EventRequestDraftInput.safeParse({ proposedDates: [{ start: value }] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["proposedDates", 0, "start"]);
  });

  it.each([
    ["2026-11-18T09:30", "2026-11-18T09:30"],
    ["2026-11-18T09:30", "2026-11-18T09:29"],
    ["2026-11-18T09:30", "2026-11-17T09:30"],
  ])("refuses the range starting %s and ending %s", (start, end) => {
    const result = EventRequestDraftInput.safeParse({ proposedDates: [{ start, end }] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["proposedDates", 0, "end"],
      message: END_BEFORE_START_MESSAGE,
    });
  });

  it("checks the order of every proposed date line, not just the first", () => {
    const result = EventRequestDraftInput.safeParse({
      proposedDates: [
        { start: "2026-10-10T09:00", end: "2026-10-10T17:00" },
        { start: "2026-10-12T14:00", end: "2026-10-12T13:00" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["proposedDates", 1, "end"]);
  });

  it("accepts a leap day and an end on the following day without timezone conversion", () => {
    const proposedDates = [{ start: "2000-02-29T23:30", end: "2000-03-01T00:30" }];

    expect(EventRequestDraftInput.parse({ proposedDates }).proposedDates).toEqual(proposedDates);
  });

  it.each([0, -1, 2.5, NaN, Infinity, 2_147_483_648])(
    "refuses an expected attendance of %s",
    value => {
      const result = EventRequestDraftInput.safeParse({ expectedAttendance: value });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe(ATTENDANCE_MESSAGE);
    }
  );

  it.each([1, 2_147_483_647])("accepts a positive whole attendance of %s", value => {
    expect(EventRequestDraftInput.parse({ expectedAttendance: value }).expectedAttendance).toBe(
      value
    );
  });

  it("allows a half-typed equipment line", () => {
    const equipmentRequirements = [{ type: "Projector" }, { type: "", quantity: 2 }];

    expect(EventRequestDraftInput.parse({ equipmentRequirements }).equipmentRequirements).toEqual(
      equipmentRequirements
    );
  });

  it("refuses a non-positive or fractional equipment quantity", () => {
    const badQuantity = EventRequestDraftInput.safeParse({
      equipmentRequirements: [{ type: "Projector", quantity: 0 }],
    });

    expect(badQuantity.success).toBe(false);
    expect(badQuantity.error?.issues[0]).toMatchObject({
      path: ["equipmentRequirements", 0, "quantity"],
      message: EQUIPMENT_QUANTITY_MESSAGE,
    });
  });

  it("accepts repeated equipment lines in their original order", () => {
    const equipmentRequirements = [
      { type: "  Wireless microphones  ", quantity: 2 },
      { type: "HDMI projector & screen", quantity: 1 },
    ];

    expect(EventRequestDraftInput.parse({ equipmentRequirements }).equipmentRequirements).toEqual(
      equipmentRequirements
    );
  });

  it("refuses free text longer than the column is meant to hold", () => {
    const longName = EventRequestDraftInput.safeParse({
      eventName: "a".repeat(EVENT_NAME_MAX_LENGTH + 1),
    });
    expect(longName.success).toBe(false);
    expect(longName.error?.issues[0].message).toBe(EVENT_NAME_MESSAGE);

    const longPurpose = EventRequestDraftInput.safeParse({
      purpose: "a".repeat(PURPOSE_MAX_LENGTH + 1),
    });
    expect(longPurpose.success).toBe(false);
    expect(longPurpose.error?.issues[0].message).toBe(PURPOSE_MESSAGE);
  });

  it("accepts free text right up to the limit", () => {
    const parsed = EventRequestDraftInput.parse({
      eventName: "a".repeat(EVENT_NAME_MAX_LENGTH),
      purpose: "b".repeat(PURPOSE_MAX_LENGTH),
    });

    expect(parsed.eventName).toHaveLength(EVENT_NAME_MAX_LENGTH);
    expect(parsed.purpose).toHaveLength(PURPOSE_MAX_LENGTH);
  });

  it("carries the id of a draft already saved this sitting", () => {
    expect(EventRequestDraftInput.parse({ id: 7 })).toMatchObject({ id: 7 });
    expect(EventRequestDraftInput.parse({})).not.toHaveProperty("id");
  });

  it.each([0, -1, 1.5])("refuses the id %s", value => {
    expect(EventRequestDraftInput.safeParse({ id: value }).success).toBe(false);
  });
});

describe("EventRequestDraftFormInput", () => {
  it("is a standard-schema validator, so TanStack Form can attach issues to fields", () => {
    expect("~standard" in EventRequestDraftFormInput).toBe(true);
  });

  it("parses a blank form into a blank draft", () => {
    expect(EventRequestDraftFormInput.parse(BLANK_FORM)).toEqual(BLANK_DRAFT);
  });

  it("converts the form's strings and drops every blank row", () => {
    const parsed = EventRequestDraftFormInput.parse({
      ...BLANK_FORM,
      eventName: "Workshop",
      expectedAttendance: "25",
      proposedDates: [
        { key: "1", start: "2026-10-10T09:00", end: "" },
        { key: "2", start: "", end: "" },
      ],
      equipmentRequirements: [
        { key: "3", type: "Projector", quantity: "2" },
        { key: "4", type: "", quantity: "" },
      ],
    });

    expect(parsed).toEqual({
      ...BLANK_DRAFT,
      eventName: "Workshop",
      expectedAttendance: 25,
      proposedDates: [{ start: "2026-10-10T09:00" }],
      equipmentRequirements: [{ type: "Projector", quantity: 2 }],
    });
  });

  it.each(["0", "-1", "1.5", "twenty"])("reports an attendance of %s at its own field", value => {
    const result = EventRequestDraftFormInput.safeParse({
      ...BLANK_FORM,
      expectedAttendance: value,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["expectedAttendance"],
      message: ATTENDANCE_MESSAGE,
    });
  });

  it("reports an out-of-order window at the row's end field", () => {
    const result = EventRequestDraftFormInput.safeParse({
      ...BLANK_FORM,
      proposedDates: [{ key: "1", start: "2026-10-10T09:00", end: "2026-10-10T08:00" }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["proposedDates", 0, "end"],
      message: END_BEFORE_START_MESSAGE,
    });
  });

  it("reports a fractional quantity at its equipment row", () => {
    const result = EventRequestDraftFormInput.safeParse({
      ...BLANK_FORM,
      equipmentRequirements: [{ key: "1", type: "Projector", quantity: "1.5" }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["equipmentRequirements", 0, "quantity"],
      message: EQUIPMENT_QUANTITY_MESSAGE,
    });
  });
});

describe("parseDraftInput", () => {
  it("rethrows the first validation message, not a raw ZodError", () => {
    expect(() =>
      parseDraftInput({
        proposedDates: [{ start: "2026-11-18T09:30", end: "2026-11-18T09:00" }],
      })
    ).toThrow(END_BEFORE_START_MESSAGE);
  });

  it("returns the parsed draft", () => {
    expect(parseDraftInput({ eventName: "Workshop" })).toEqual({
      ...BLANK_DRAFT,
      eventName: "Workshop",
    });
  });
});

describe("missingRequiredFields", () => {
  const completeDraft = {
    eventName: "Community workshop",
    purpose: "Meet volunteers",
    proposedDates: [{ start: "2026-10-10T09:00", end: "2026-10-10T17:00" }],
    expectedAttendance: 25,
  };

  it("reports nothing when every mandatory field is supplied", () => {
    expect(missingRequiredFields(completeDraft)).toEqual([]);
  });

  it("reports each mandatory field that is absent or blank", () => {
    expect(missingRequiredFields({ ...completeDraft, eventName: "  " })).toEqual(["Event name"]);
    expect(missingRequiredFields({ ...completeDraft, purpose: "" })).toEqual(["Purpose"]);
    expect(missingRequiredFields({ ...completeDraft, expectedAttendance: undefined })).toEqual([
      "Expected attendance",
    ]);
    expect(missingRequiredFields({ ...completeDraft, expectedAttendance: null })).toEqual([
      "Expected attendance",
    ]);
  });

  it("reports an absent proposed date list", () => {
    expect(missingRequiredFields({ ...completeDraft, proposedDates: [] })).toEqual([
      "Proposed dates and times",
    ]);
  });

  it("reports a proposed date line that is missing a side", () => {
    const proposedDates = [
      { start: "2026-10-12T09:00", end: "2026-10-12T17:00" },
      { start: "2026-10-10T09:00" },
    ];

    expect(missingRequiredFields({ ...completeDraft, proposedDates })).toEqual([
      "Proposed dates and times",
    ]);
  });

  it("reports every missing mandatory field in form order", () => {
    expect(
      missingRequiredFields({
        eventName: " ",
        purpose: "",
        proposedDates: [],
        expectedAttendance: null,
      })
    ).toEqual(["Event name", "Purpose", "Proposed dates and times", "Expected attendance"]);
  });
});
