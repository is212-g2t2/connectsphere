/** PTR-43 unit tests: the arrangement-completion predicate and read-time guard (pure functions only). */
import { describe, expect, it } from "vitest";

import {
  parseCompleteArrangementsInput,
  parseRecordUnavailableInput,
} from "#/features/equipment-requests/schema";
import {
  effectiveEquipmentArrangementsCompletedAt,
  isEquipmentArrangementsSatisfied,
  isEquipmentQueueRow,
  projectEvent,
} from "#/features/events/access";

const at = new Date("2026-10-01T00:00:00Z");
const line = (arrangementStatus: string) => ({ arrangementStatus });

// ── AC4: the read-time guard ────────────────────────────────────────────────────────────────
describe("effectiveEquipmentArrangementsCompletedAt (PTR-43 AC4)", () => {
  it.each([
    ["all reserved", [line("reserved")], at.toISOString()],
    ["reserved + not_required", [line("reserved"), line("not_required")], at.toISOString()],
    ["only not_required", [line("not_required")], at.toISOString()],
    ["one requested", [line("reserved"), line("requested")], null],
    ["one unavailable", [line("not_required"), line("unavailable")], null],
    ["unknown status", [line("reserved"), line("weird")], null],
    ["no lines", [], null],
  ])("%s", (_name, lines, expected) => {
    expect(effectiveEquipmentArrangementsCompletedAt(at, lines)).toBe(expected);
  });

  it.each([null, undefined])("is null when no completion was recorded (%s)", completedAt => {
    expect(effectiveEquipmentArrangementsCompletedAt(completedAt, [line("reserved")])).toBeNull();
  });
});

// ── AC4 / AC6: the confirmation gate value ──────────────────────────────────────────────────
describe("isEquipmentArrangementsSatisfied (PTR-43 AC4/AC6, PTR-24 AC5)", () => {
  it.each([null, undefined])("no lines is satisfied without any completion (%s)", completedAt => {
    expect(isEquipmentArrangementsSatisfied([], completedAt)).toBe(true);
  });

  it("no lines stays satisfied even if a stray completion exists", () => {
    expect(isEquipmentArrangementsSatisfied([], at)).toBe(true);
  });

  it.each([
    ["reserved, not completed", [line("reserved")], null, false],
    ["reserved, completed", [line("reserved")], at, true],
    ["reserved, completed (ISO string)", [line("reserved")], at.toISOString(), true],
    ["not_required only, completed", [line("not_required")], at, true],
    ["completed but a line requested", [line("reserved"), line("requested")], at, false],
    ["completed but a line unavailable", [line("unavailable")], at, false],
    [
      "all arranged but never completed",
      [line("reserved"), line("not_required")],
      undefined,
      false,
    ],
  ])("with lines: %s", (_name, lines, completedAt, expected) => {
    expect(isEquipmentArrangementsSatisfied(lines, completedAt)).toBe(expected);
  });
});

// ── The queue rule both PTR-43 handlers rely on ─────────────────────────────────────────────
describe("isEquipmentQueueRow (gates complete + record-unavailable)", () => {
  const me = "tech-a";
  it.each([
    [
      "unassigned requested, event submitted",
      { assignedStaffId: null, arrangementStatus: "requested" },
      true,
      true,
    ],
    [
      "unassigned requested, event NOT submitted",
      { assignedStaffId: null, arrangementStatus: "requested" },
      false,
      false,
    ],
    [
      "unassigned not_required (not pending)",
      { assignedStaffId: null, arrangementStatus: "not_required" },
      true,
      false,
    ],
    [
      "assigned to me, any state",
      { assignedStaffId: me, arrangementStatus: "reserved" },
      true,
      true,
    ],
    [
      "assigned to me, event not submitted",
      { assignedStaffId: me, arrangementStatus: "requested" },
      false,
      true,
    ],
    [
      "assigned to a colleague",
      { assignedStaffId: "tech-b", arrangementStatus: "requested" },
      true,
      false,
    ],
  ])("%s", (_name, row, submitted, expected) => {
    expect(isEquipmentQueueRow(row, me, submitted)).toBe(expected);
  });
});

// ── AC4: what each role is shown ────────────────────────────────────────────────────────────
const record = (completedAt: Date | null) => ({
  id: 1,
  name: "Gala",
  description: "",
  status: "planning" as const,
  proposedDates: [{ start: "2030-01-01T10:00", end: "2030-01-01T12:00" }],
  registrationEnabled: false,
  equipmentSubmittedAt: new Date(),
  equipmentArrangementsCompletedAt: completedAt,
  expectedAttendance: 10,
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  venueRequirements: "",
  registrationOpensAt: null,
  registrationClosesAt: null,
});
const equipment = (status: string) => [
  { id: "a", item: "Mic", quantity: 1, arrangementStatus: status, notes: null },
];
describe("projectEvent completion field (PTR-43 AC4)", () => {
  it.each(["technical_support", "coordinator"] as const)("%s sees the completion time", access => {
    const p = projectEvent(record(at), access, null, equipment("reserved"), null);
    expect(p.event.equipmentArrangementsCompletedAt).toBe(at.toISOString());
  });

  it.each(["technical_support", "coordinator"] as const)(
    "%s sees null when a line is no longer arranged (stale stamp hidden)",
    access => {
      const p = projectEvent(record(at), access, null, equipment("requested"), null);
      expect(p.event.equipmentArrangementsCompletedAt).toBeNull();
    }
  );

  it.each(["technical_support", "coordinator"] as const)(
    "%s sees null when nothing was recorded",
    access => {
      const p = projectEvent(record(null), access, null, equipment("reserved"), null);
      expect(p.event.equipmentArrangementsCompletedAt).toBeNull();
    }
  );

  it.each(["organiser", "venue_staff", "attendee"] as const)(
    "%s never receives the field",
    access => {
      const p = projectEvent(record(at), access, null, equipment("reserved"), null);
      expect(p.event).not.toHaveProperty("equipmentArrangementsCompletedAt");
    }
  );

  it("technical_support sees no completion for an event with no lines (AC6)", () => {
    const p = projectEvent(record(at), "technical_support", null, [], null);
    expect(p.event.equipmentArrangementsCompletedAt).toBeNull();
    expect(p.event.equipmentArrangementsSatisfied).toBe(true);
  });

  it("coordinator sees the gate satisfied only after completion on arranged lines", () => {
    const arranged = equipment("reserved");
    expect(
      projectEvent(record(null), "coordinator", null, arranged, null).event
        .equipmentArrangementsSatisfied
    ).toBe(false);
    expect(
      projectEvent(record(at), "coordinator", null, arranged, null).event
        .equipmentArrangementsSatisfied
    ).toBe(true);
  });
});

// ── AC1: input validation for completing ────────────────────────────────────────────────────
describe("parseCompleteArrangementsInput (PTR-43 AC1)", () => {
  it("rejects a non-object payload", () => {
    expect(() => parseCompleteArrangementsInput(null)).toThrow("Invalid input");
  });

  it("accepts a positive integer event id", () => {
    expect(parseCompleteArrangementsInput({ eventId: 7 })).toEqual({ eventId: 7 });
  });

  it.each([
    ["zero", { eventId: 0 }],
    ["negative", { eventId: -3 }],
    ["fraction", { eventId: 1.5 }],
    ["string", { eventId: "7" }],
    ["missing", {}],
  ])("rejects %s with the event message", (_name, input) => {
    expect(() => parseCompleteArrangementsInput(input)).toThrow("Choose an event");
  });
});

// ── AC2: input validation for unavailable ───────────────────────────────────────────────────
describe("parseRecordUnavailableInput (PTR-43 AC2)", () => {
  const ok = { eventId: 1, id: "eq-1", reason: "Out for repair" };

  it("accepts and trims a valid input", () => {
    expect(parseRecordUnavailableInput({ ...ok, reason: "  Out for repair  " })).toEqual(ok);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "     "],
    ["zero-width only", "\u200b\u200b"],
    ["missing", undefined],
    ["not a string", 42],
  ])("rejects a %s reason", (_name, reason) => {
    expect(() => parseRecordUnavailableInput({ ...ok, reason })).toThrow(
      "Give a reason for marking this line unavailable"
    );
  });

  it("accepts a reason of exactly 2000 characters and rejects 2001", () => {
    expect(() => parseRecordUnavailableInput({ ...ok, reason: "x".repeat(2000) })).not.toThrow();
    expect(() => parseRecordUnavailableInput({ ...ok, reason: "x".repeat(2001) })).toThrow(
      "Reason must be 2000 characters or fewer"
    );
  });

  it.each([
    ["empty line id", { ...ok, id: "" }],
    ["blank line id", { ...ok, id: "   " }],
    ["line id over 64 chars", { ...ok, id: "x".repeat(65) }],
    ["missing line id", { eventId: 1, reason: "r" }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseRecordUnavailableInput(input)).toThrow("Choose an equipment line");
  });

  it("rejects a bad event id", () => {
    expect(() => parseRecordUnavailableInput({ ...ok, eventId: 0 })).toThrow("Choose an event");
  });
});
