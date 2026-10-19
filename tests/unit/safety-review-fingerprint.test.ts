import { describe, expect, it } from "vitest";

import { arrangementFingerprintOf } from "#/features/safety-reviews/fingerprint.server";
import type { ArrangementFingerprintInput } from "#/features/safety-reviews/fingerprint.server";
import { parseSafetyReviewDecision } from "#/features/safety-reviews/schema";

/**
 * PTR-146: the fingerprint must change for every material arrangement change and for nothing
 * else. The loader's SQL is covered by the integration test; this file covers the canonical hash.
 */
const base: ArrangementFingerprintInput = {
  event: {
    proposedDates: [{ start: "2030-01-01T09:00", end: "2030-01-01T17:00" }],
    expectedAttendance: 100,
    venueRequirements: "Projector",
    equipmentRequirements: [{ key: "e1", type: "Microphone", quantity: "2" }],
    roomLayoutPreference: "Theatre",
  },
  bookings: [
    {
      id: "B",
      venueId: 1,
      startsAt: "2030-01-01 09:00:00",
      endsAt: "2030-01-01 17:00:00",
      suspended: false,
      expectedAttendance: 100,
      layout: "Theatre",
      accessibilityRequirements: "",
      requiredFacilities: "",
    },
    {
      id: "a",
      venueId: 1,
      startsAt: "2030-01-01 09:00:00",
      endsAt: "2030-01-01 17:00:00",
      suspended: false,
      expectedAttendance: 100,
      layout: "Theatre",
      accessibilityRequirements: "",
      requiredFacilities: "",
    },
  ],
  venueRequests: [
    { id: "B", status: "pending" },
    { id: "a", status: "pending" },
  ],
  equipment: [
    {
      item: "Projector",
      type: 2,
      quantity: 1,
      state: "reserved",
      reservedType: 2,
      reservedQuantity: 1,
    },
  ],
  equipmentCompleted: true,
};

const fingerprint = (input: ArrangementFingerprintInput = base) => arrangementFingerprintOf(input);

describe("arrangementFingerprintOf (PTR-146)", () => {
  it("is stable across row order", () => {
    const shuffled = structuredClone(base);
    shuffled.bookings.reverse();
    shuffled.venueRequests.reverse();
    shuffled.equipment.reverse();
    expect(fingerprint(shuffled)).toBe(fingerprint());
  });

  it("changes when a booking changes, including its suspension and session requirements", () => {
    const cases: Array<[string, (input: ArrangementFingerprintInput) => void]> = [
      ["window", input => (input.bookings[0].startsAt = "2030-01-01 10:00:00")],
      ["venue", input => (input.bookings[0].venueId = 2)],
      ["suspension", input => (input.bookings[0].suspended = true)],
      ["session attendance", input => (input.bookings[0].expectedAttendance = 90)],
      ["session layout", input => (input.bookings[0].layout = "Cabaret")],
      ["session facilities", input => (input.bookings[0].requiredFacilities = "Stage")],
      ["session accessibility", input => (input.bookings[0].accessibilityRequirements = "Ramp")],
    ];
    for (const [name, change] of cases) {
      const input = structuredClone(base);
      change(input);
      expect(`${name}:${fingerprint(input)}`).not.toBe(`${name}:${fingerprint()}`);
    }
  });

  it("changes when an outstanding request, a line, the completion marker, a significant field or the layout changes", () => {
    const cases: Array<[string, (input: ArrangementFingerprintInput) => void]> = [
      ["request status", input => (input.venueRequests[0].status = "rejected")],
      ["request added", input => input.venueRequests.push({ id: "pending-2", status: "pending" })],
      ["line quantity", input => (input.equipment[0].quantity = 2)],
      ["line state", input => (input.equipment[0].state = "requested")],
      ["line type", input => (input.equipment[0].type = 3)],
      ["reservation", input => (input.equipment[0].reservedQuantity = 0)],
      ["completion marker", input => (input.equipmentCompleted = false)],
      ["proposed dates", input => (input.event.proposedDates = [])],
      ["expected attendance", input => (input.event.expectedAttendance = 90)],
      ["venue requirements", input => (input.event.venueRequirements = "Stage")],
      ["equipment requirements", input => (input.event.equipmentRequirements = [])],
      ["layout preference", input => (input.event.roomLayoutPreference = "Cabaret")],
    ];
    for (const [name, change] of cases) {
      const input = structuredClone(base);
      change(input);
      expect(`${name}:${fingerprint(input)}`).not.toBe(`${name}:${fingerprint()}`);
    }
  });

  it("is a hex digest, not the input", () => {
    expect(fingerprint()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("SafetyReviewDecisionInput (PTR-146 AC3)", () => {
  const valid = { reviewId: 4, decision: "approved", fingerprint: "abc", comments: "" };

  it("accepts an approval without comments and a rejection with them", () => {
    expect(parseSafetyReviewDecision(valid)).toMatchObject(valid);
    expect(
      parseSafetyReviewDecision({
        ...valid,
        decision: "changes_requested",
        comments: "Add an exit",
      })
    ).toMatchObject({ decision: "changes_requested", comments: "Add an exit" });
  });

  it("refuses a rejection or change request without comments", () => {
    for (const decision of ["rejected", "changes_requested"] as const) {
      expect(() => parseSafetyReviewDecision({ ...valid, decision })).toThrow(
        "Give the reason for your decision"
      );
    }
  });

  it("refuses a missing fingerprint, an unknown decision and a missing review", () => {
    expect(() => parseSafetyReviewDecision({ ...valid, fingerprint: "" })).toThrow(
      "Reload the review before you decide"
    );
    expect(() => parseSafetyReviewDecision({ ...valid, decision: "pending" })).toThrow(
      "Choose approve, reject or request changes"
    );
    expect(() => parseSafetyReviewDecision({ decision: "approved", fingerprint: "abc" })).toThrow(
      "Choose a safety review"
    );
  });
});
