import { describe, expect, it } from "vitest";

import type { EventRequestStatus } from "#/features/event-requests/schema";
import {
  CONFIRMATION_REFUSAL_HEADING,
  VENUE_BOOKING_OUTSTANDING_MESSAGE,
  EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE,
  confirmationBlockers,
  confirmationRefusalMessage,
} from "#/features/events/confirmation";

const approvedBooking = ["approved"];
const settled = [
  { item: "Projector", arrangementStatus: "reserved" },
  { item: "Microphone", arrangementStatus: "not_required" },
];

const completedAt = new Date("2026-10-01T00:00:00Z");

/** Settled by default (PTR-43's stamp present); a case passes `null` to leave it unmarked. */
function blockersFor(
  input: Omit<Parameters<typeof confirmationBlockers>[0], "equipmentArrangementsCompletedAt"> & {
    equipmentArrangementsCompletedAt?: Date | null;
  }
) {
  return confirmationBlockers({ equipmentArrangementsCompletedAt: completedAt, ...input });
}

describe("confirmationBlockers (PTR-24)", () => {
  it("reports no blockers when the booking is approved and every line is settled", () => {
    for (const status of ["approved", "planning"] as const) {
      expect(
        blockersFor({
          status,
          venueRequestStatuses: approvedBooking,
          equipmentLines: settled,
        })
      ).toEqual([]);
    }
  });

  it("names a missing approved venue booking (none, pending, rejected, released, withdrawn)", () => {
    for (const venueRequestStatuses of [
      [],
      ["pending"],
      ["rejected"],
      ["released"],
      ["withdrawn"],
    ]) {
      expect(
        blockersFor({ status: "approved", venueRequestStatuses, equipmentLines: settled })
      ).toEqual([VENUE_BOOKING_OUTSTANDING_MESSAGE]);
    }
  });

  it("accepts an approved booking beside an older released one", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequestStatuses: ["released", "approved"],
        equipmentLines: [],
      })
    ).toEqual([]);
  });

  it("names every outstanding equipment line and no settled one", () => {
    const blockers = blockersFor({
      status: "approved",
      venueRequestStatuses: approvedBooking,
      equipmentLines: [
        { item: "Projector", arrangementStatus: "requested" },
        { item: "Microphone", arrangementStatus: "unavailable" },
        { item: "Speaker", arrangementStatus: "reserved" },
      ],
    });
    expect(blockers).toEqual([
      "Projector is not arranged (requested).",
      "Microphone is not arranged (unavailable).",
    ]);
  });

  it("returns every blocker, not only the first", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequestStatuses: [],
        equipmentLines: [{ item: "Projector", arrangementStatus: "requested" }],
      })
    ).toEqual([VENUE_BOOKING_OUTSTANDING_MESSAGE, "Projector is not arranged (requested)."]);
  });

  it("the equipment gate passes when no lines are recorded", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequestStatuses: approvedBooking,
        equipmentLines: [],
      })
    ).toEqual([]);
    expect(
      blockersFor({ status: "approved", venueRequestStatuses: [], equipmentLines: [] })
    ).toEqual([VENUE_BOOKING_OUTSTANDING_MESSAGE]);
  });

  it("treats reserved and not_required as complete", () => {
    for (const arrangementStatus of ["reserved", "not_required"]) {
      expect(
        blockersFor({
          status: "approved",
          venueRequestStatuses: approvedBooking,
          equipmentLines: [{ item: "Projector", arrangementStatus }],
        })
      ).toEqual([]);
    }
  });

  it("treats requested and unavailable as outstanding", () => {
    for (const arrangementStatus of ["requested", "unavailable"]) {
      expect(
        blockersFor({
          status: "approved",
          venueRequestStatuses: approvedBooking,
          equipmentLines: [{ item: "Projector", arrangementStatus }],
        })
      ).toHaveLength(1);
    }
  });

  it("refuses every status other than approved and planning and names it", () => {
    const statuses: EventRequestStatus[] = [
      "draft",
      "submitted",
      "under_review",
      "rejected",
      "awaiting_organiser",
      "confirmed",
      "completed",
      "cancelled",
    ];
    for (const status of statuses) {
      const blockers = blockersFor({
        status,
        venueRequestStatuses: approvedBooking,
        equipmentLines: settled,
      });
      expect(blockers).toHaveLength(1);
      expect(blockers[0]).toContain(status.replaceAll("_", " "));
    }
  });

  it("gives only the status for a refused status, even with arrangements missing", () => {
    expect(
      blockersFor({
        status: "cancelled",
        venueRequestStatuses: [],
        equipmentLines: [{ item: "Projector", arrangementStatus: "requested" }],
      })
    ).toEqual(["Its status is cancelled."]);
  });
});

describe("confirmationBlockers equipment completion (PTR-24 over PTR-43)", () => {
  it("refuses when every line is arranged but Technical Support has not marked it complete", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequestStatuses: approvedBooking,
        equipmentLines: settled,
        equipmentArrangementsCompletedAt: null,
      })
    ).toEqual([EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE]);
  });

  it("names the outstanding lines and not the completion message when a line is open", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequestStatuses: approvedBooking,
        equipmentLines: [{ item: "Projector", arrangementStatus: "requested" }],
        equipmentArrangementsCompletedAt: null,
      })
    ).toEqual(["Projector is not arranged (requested)."]);
  });

  it("needs no completion mark when no equipment is recorded", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequestStatuses: approvedBooking,
        equipmentLines: [],
        equipmentArrangementsCompletedAt: null,
      })
    ).toEqual([]);
  });
});

describe("confirmationRefusalMessage", () => {
  it("leads with the heading and lists each reason on its own line", () => {
    expect(confirmationRefusalMessage(["A.", "B."])).toBe(
      `${CONFIRMATION_REFUSAL_HEADING}\n- A.\n- B.`
    );
  });
});
