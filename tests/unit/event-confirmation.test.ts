import { describe, expect, it } from "vitest";

import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { VenueRequestStatus } from "#/features/venue-requests/schema";
import {
  CONFIRMATION_REFUSAL_HEADING,
  MULTIPLE_VENUE_BOOKINGS_MESSAGE,
  VENUE_BOOKING_OUTSTANDING_MESSAGE,
  EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE,
  confirmationBlockers,
  confirmationRefusalMessage,
  pendingVenueRequestMessage,
} from "#/features/events/confirmation";

/** One venue request row with the given status, at a fixed venue and window. */
function request(status: VenueRequestStatus, venueName = "Great Hall") {
  return { status, venueName, startsAt: "2030-01-01 09:00:00", endsAt: "2030-01-01 12:30:00" };
}

const approvedBooking = [request("approved")];
const settled = [
  { item: "Projector", arrangementStatus: "reserved" },
  { item: "Microphone", arrangementStatus: "not_required" },
];

const completedAt = new Date("2026-10-01T00:00:00Z");

/** Settle by default with PTR-43's stamp present. A case passes `null` to leave it unmarked. */
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
          venueRequests: approvedBooking,
          equipmentLines: settled,
        })
      ).toEqual([]);
    }
  });

  it("names a missing approved venue booking (none, rejected, released, withdrawn)", () => {
    for (const venueRequests of [
      [],
      [request("rejected")],
      [request("released")],
      [request("withdrawn")],
    ]) {
      expect(blockersFor({ status: "approved", venueRequests, equipmentLines: settled })).toEqual([
        VENUE_BOOKING_OUTSTANDING_MESSAGE,
      ]);
    }
  });

  it("names a pending request by venue and window when it is the only request", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("pending")],
        equipmentLines: settled,
      })
    ).toEqual([
      VENUE_BOOKING_OUTSTANDING_MESSAGE,
      "The booking request for Great Hall (1 Jan 2030, 09:00 – 12:30) is still pending.",
    ]);
  });

  it("refuses an approved booking beside a pending request, one entry per pending request (PTR-138)", () => {
    const pendingHall = request("pending", "Annex");
    const pendingRoom = {
      ...request("pending", "Seminar Room"),
      startsAt: "2030-01-01 23:00:00",
      endsAt: "2030-01-02 01:00:00",
    };

    expect(
      blockersFor({
        status: "planning",
        venueRequests: [request("approved"), pendingHall, request("withdrawn"), pendingRoom],
        equipmentLines: settled,
      })
    ).toEqual([
      "The booking request for Annex (1 Jan 2030, 09:00 – 12:30) is still pending.",
      "The booking request for Seminar Room (1 Jan 2030, 23:00 – 2 Jan 2030, 01:00) is still pending.",
    ]);
    expect(pendingVenueRequestMessage(pendingHall)).toBe(
      "The booking request for Annex (1 Jan 2030, 09:00 – 12:30) is still pending."
    );
  });

  it("accepts an approved booking beside an older released one", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("released"), request("approved")],
        equipmentLines: [],
      })
    ).toEqual([]);
  });

  it("refuses more than one approved venue booking", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("approved"), request("approved")],
        equipmentLines: [],
      })
    ).toEqual([MULTIPLE_VENUE_BOOKINGS_MESSAGE]);
  });

  it("names every outstanding equipment line and no settled one", () => {
    const blockers = blockersFor({
      status: "approved",
      venueRequests: approvedBooking,
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
        venueRequests: [],
        equipmentLines: [{ item: "Projector", arrangementStatus: "requested" }],
      })
    ).toEqual([VENUE_BOOKING_OUTSTANDING_MESSAGE, "Projector is not arranged (requested)."]);
  });

  it("the equipment gate passes when no lines are recorded", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: approvedBooking,
        equipmentLines: [],
      })
    ).toEqual([]);
    expect(blockersFor({ status: "approved", venueRequests: [], equipmentLines: [] })).toEqual([
      VENUE_BOOKING_OUTSTANDING_MESSAGE,
    ]);
  });

  it("treats reserved and not_required as complete", () => {
    for (const arrangementStatus of ["reserved", "not_required"]) {
      expect(
        blockersFor({
          status: "approved",
          venueRequests: approvedBooking,
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
          venueRequests: approvedBooking,
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
        venueRequests: approvedBooking,
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
        venueRequests: [],
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
        venueRequests: approvedBooking,
        equipmentLines: settled,
        equipmentArrangementsCompletedAt: null,
      })
    ).toEqual([EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE]);
  });

  it("names the outstanding lines and not the completion message when a line is open", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: approvedBooking,
        equipmentLines: [{ item: "Projector", arrangementStatus: "requested" }],
        equipmentArrangementsCompletedAt: null,
      })
    ).toEqual(["Projector is not arranged (requested)."]);
  });

  it("needs no completion mark when no equipment is recorded", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: approvedBooking,
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
