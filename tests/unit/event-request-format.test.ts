import { describe, expect, it } from "vitest";

import { formatLocalDateTime, formatProposedWindow } from "#/features/event-requests/format";

describe("formatLocalDateTime (PTR-14)", () => {
  it("renders a stored datetime-local value as a readable wall-clock", () => {
    expect(formatLocalDateTime("2030-11-18T09:30")).toBe("18 Nov 2030, 09:30");
    expect(formatLocalDateTime("2030-01-05T00:00")).toBe("5 Jan 2030, 00:00");
  });

  it("returns anything outside that shape untouched rather than guessing", () => {
    for (const value of ["", "2030-11-18", "2030-13-18T09:30", "2030-00-18T09:30", "soon"]) {
      expect(formatLocalDateTime(value)).toBe(value);
    }
  });
});

describe("formatProposedWindow (PTR-14)", () => {
  it("collapses a same-day window to one date", () => {
    expect(formatProposedWindow({ start: "2030-11-18T09:30", end: "2030-11-18T12:45" })).toBe(
      "18 Nov 2030, 09:30 – 12:45"
    );
  });

  it("spells out both ends of a window that crosses midnight", () => {
    expect(formatProposedWindow({ start: "2030-11-18T22:00", end: "2030-11-19T01:00" })).toBe(
      "18 Nov 2030, 22:00 – 19 Nov 2030, 01:00"
    );
  });

  it("shows what is known of a half-entered draft window", () => {
    expect(formatProposedWindow({ start: "2030-11-18T09:30" })).toBe("18 Nov 2030, 09:30 – ?");
    expect(formatProposedWindow({ end: "2030-11-18T12:45" })).toBe("? – 18 Nov 2030, 12:45");
    expect(formatProposedWindow({})).toBe("Not yet chosen");
  });
});
