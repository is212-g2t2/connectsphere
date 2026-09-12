import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_MESSAGE,
  END_BEFORE_START_MESSAGE,
  EVENT_NAME_MAX_LENGTH,
  EVENT_NAME_MESSAGE,
  EventRequestDraftInput,
  PURPOSE_MAX_LENGTH,
  PURPOSE_MESSAGE,
  parseDraftInput,
} from "#/features/event-requests/schema";

describe("EventRequestDraftInput", () => {
  it("saves an entirely blank draft", () => {
    expect(EventRequestDraftInput.parse({})).toEqual({ eventName: "", purpose: "" });
  });

  it("keeps a supplied field exactly as entered", () => {
    const parsed = EventRequestDraftInput.parse({
      eventName: "  Community workshop  ",
      purpose: "Meet neighbours\n  Plan next steps  ",
    });

    expect(parsed).toEqual({
      eventName: "  Community workshop  ",
      purpose: "Meet neighbours\n  Plan next steps  ",
    });
  });

  it("accepts the full set of draft fields", () => {
    const parsed = EventRequestDraftInput.parse({
      eventName: "Workshop",
      purpose: "Plan",
      proposedStart: "2028-02-29T09:30",
      proposedEnd: "2028-02-29T12:45",
      expectedAttendance: 25,
    });

    expect(parsed).toMatchObject({
      proposedStart: "2028-02-29T09:30",
      proposedEnd: "2028-02-29T12:45",
      expectedAttendance: 25,
    });
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
    const result = EventRequestDraftInput.safeParse({ proposedStart: value });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["proposedStart"]);
  });

  it.each([
    ["2026-11-18T09:30", "2026-11-18T09:30"],
    ["2026-11-18T09:30", "2026-11-18T09:29"],
  ])("refuses the range starting %s and ending %s", (start, end) => {
    const result = EventRequestDraftInput.safeParse({ proposedStart: start, proposedEnd: end });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["proposedEnd"],
      message: END_BEFORE_START_MESSAGE,
    });
  });

  it("leaves the order unchecked while one side of the range is absent", () => {
    expect(EventRequestDraftInput.parse({ proposedEnd: "2026-11-18T09:30" })).toMatchObject({
      proposedEnd: "2026-11-18T09:30",
    });
  });

  it.each([0, -1, 2.5])("refuses an expected attendance of %s", value => {
    const result = EventRequestDraftInput.safeParse({ expectedAttendance: value });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(ATTENDANCE_MESSAGE);
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

describe("parseDraftInput", () => {
  it("rethrows the first validation message, not a raw ZodError", () => {
    expect(() =>
      parseDraftInput({ proposedStart: "2026-11-18T09:30", proposedEnd: "2026-11-18T09:00" })
    ).toThrow(END_BEFORE_START_MESSAGE);
  });

  it("returns the parsed draft", () => {
    expect(parseDraftInput({ eventName: "Workshop" })).toEqual({
      eventName: "Workshop",
      purpose: "",
    });
  });
});
