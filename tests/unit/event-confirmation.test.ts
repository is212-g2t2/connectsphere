import { describe, expect, it } from "vitest";

import type { EventRequestStatus } from "#/features/event-requests/schema";
import type { VenueRequestStatus } from "#/features/venue-requests/schema";
import {
  CONFIRMATION_REFUSAL_HEADING,
  VENUE_BOOKING_OUTSTANDING_MESSAGE,
  VENUE_BOOKING_SUSPENDED_MESSAGE,
  EQUIPMENT_COMPLETION_OUTSTANDING_MESSAGE,
  SAFETY_REVIEW_CHANGES_REQUESTED_MESSAGE,
  SAFETY_REVIEW_MISSING_MESSAGE,
  SAFETY_REVIEW_OUTDATED_MESSAGE,
  SAFETY_REVIEW_PENDING_MESSAGE,
  SAFETY_REVIEW_REJECTED_MESSAGE,
  confirmationBlockers,
  confirmationRefusalMessage,
  pendingVenueRequestMessage,
} from "#/features/events/confirmation";

/** One venue request row with the given status, at a fixed window. */
let nextRowId = 0;
function request(
  status: VenueRequestStatus,
  venueName = "Great Hall",
  options: { replacesRequestId?: string; dismissedAt?: Date } = {}
) {
  return {
    id: `row-${nextRowId++}`,
    status,
    venueName,
    replacesRequestId: options.replacesRequestId ?? null,
    dismissedAt: options.dismissedAt ?? null,
    startsAt: "2030-01-01 09:00:00",
    endsAt: "2030-01-01 12:30:00",
  };
}

/** Fixed timestamp used for a dismissal. */
const BASE_TIME = new Date("2029-01-01T00:00:00Z");

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
  return confirmationBlockers({
    equipmentArrangementsCompletedAt: completedAt,
    safetyReview: { state: "approved", current: true },
    ...input,
  });
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

  it.each([
    [{ state: "pending", current: true }, SAFETY_REVIEW_PENDING_MESSAGE],
    [{ state: "pending", current: false }, SAFETY_REVIEW_PENDING_MESSAGE],
    [{ state: "rejected", current: true }, SAFETY_REVIEW_REJECTED_MESSAGE],
    [{ state: "rejected", current: false }, SAFETY_REVIEW_REJECTED_MESSAGE],
    [{ state: "changes_requested", current: true }, SAFETY_REVIEW_CHANGES_REQUESTED_MESSAGE],
    [{ state: "changes_requested", current: false }, SAFETY_REVIEW_CHANGES_REQUESTED_MESSAGE],
    [{ state: "approved", current: false }, SAFETY_REVIEW_OUTDATED_MESSAGE],
    [null, SAFETY_REVIEW_MISSING_MESSAGE],
  ] as const)("requires current safety approval: %s", (safetyReview, message) => {
    expect(
      blockersFor({
        status: "planning",
        venueRequests: approvedBooking,
        equipmentLines: settled,
        safetyReview,
      })
    ).toEqual([message]);
  });

  it("names the missing approved booking and every actionable request", () => {
    expect(blockersFor({ status: "approved", venueRequests: [], equipmentLines: settled })).toEqual(
      [VENUE_BOOKING_OUTSTANDING_MESSAGE]
    );
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("rejected")],
        equipmentLines: settled,
      })
    ).toEqual([
      VENUE_BOOKING_OUTSTANDING_MESSAGE,
      "The booking request for Great Hall (1 Jan 2030, 09:00 – 12:30) was rejected.",
    ]);
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("released")],
        equipmentLines: settled,
      })
    ).toEqual([
      VENUE_BOOKING_OUTSTANDING_MESSAGE,
      "The booking for Great Hall (1 Jan 2030, 09:00 – 12:30) was released.",
    ]);
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("withdrawn")],
        equipmentLines: settled,
      })
    ).toEqual([VENUE_BOOKING_OUTSTANDING_MESSAGE]);
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

  it("names a released booking beside an approved booking", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("released"), request("approved")],
        equipmentLines: [],
      })
    ).toEqual(["The booking for Great Hall (1 Jan 2030, 09:00 – 12:30) was released."]);
  });

  it("accepts several approved venue bookings", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("approved"), request("approved")],
        equipmentLines: [],
      })
    ).toEqual([]);
  });

  it("names every pending, rejected, and released booking", () => {
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [
          request("approved"),
          request("pending", "Annex"),
          request("rejected", "Seminar Room"),
          request("released", "Auditorium"),
          request("withdrawn", "Old Hall"),
        ],
        equipmentLines: [],
      })
    ).toEqual([
      "The booking request for Annex (1 Jan 2030, 09:00 – 12:30) is still pending.",
      "The booking request for Seminar Room (1 Jan 2030, 09:00 – 12:30) was rejected.",
      "The booking for Auditorium (1 Jan 2030, 09:00 – 12:30) was released.",
    ]);
  });

  it("answers a rejected row only through the request that names it (PTR-165 AC2)", () => {
    const rejected = request("rejected", "Old Hall");
    const replacement = request("approved", "Suggested Hall", {
      replacesRequestId: rejected.id,
    });

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [rejected, replacement],
        equipmentLines: [],
      })
    ).toEqual([]);
  });

  it("keeps a rejected row when a later request does not name it (PTR-165)", () => {
    const rejected = request("rejected", "Old Hall");
    const approvedElsewhere = request("approved", "New Hall");

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [rejected, approvedElsewhere],
        equipmentLines: [],
      })
    ).toEqual(["The booking request for Old Hall (1 Jan 2030, 09:00 – 12:30) was rejected."]);
  });

  it("decides a chain of replacements by its last request (PTR-165 AC2)", () => {
    const first = request("rejected", "Old Hall");
    const second = request("rejected", "Suggested Hall", { replacesRequestId: first.id });
    const third = request("pending", "Annex", { replacesRequestId: second.id });

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("approved"), first, second, third],
        equipmentLines: [],
      })
    ).toEqual(["The booking request for Annex (1 Jan 2030, 09:00 – 12:30) is still pending."]);

    const approvedEnd = request("approved", "Annex", { replacesRequestId: second.id });
    expect(
      blockersFor({
        status: "approved",
        venueRequests: [first, second, approvedEnd],
        equipmentLines: [],
      })
    ).toEqual([]);
  });

  it("does not treat an approved row as the chain's end while it has a replacement (PTR-165 AC2)", () => {
    // The Coordinator raises a replacement for an approved booking about to be released, and that
    // replacement is then rejected. The chain ends there, so the first rejection is unanswered.
    const first = request("rejected", "Old Hall");
    const approvedMid = request("approved", "Suggested Hall", { replacesRequestId: first.id });
    const end = request("rejected", "Annex", { replacesRequestId: approvedMid.id });

    expect(
      blockersFor({
        status: "planning",
        venueRequests: [first, approvedMid, end],
        equipmentLines: [],
      })
    ).toEqual([
      "The booking request for Old Hall (1 Jan 2030, 09:00 – 12:30) was rejected.",
      "The booking request for Annex (1 Jan 2030, 09:00 – 12:30) was rejected.",
    ]);

    // The same chain with an approved end is answered throughout.
    const approvedEnd = request("approved", "Annex", { replacesRequestId: approvedMid.id });
    expect(
      blockersFor({
        status: "planning",
        venueRequests: [first, approvedMid, approvedEnd],
        equipmentLines: [],
      })
    ).toEqual([]);
  });

  it("keeps every row of a chain whose last request is settled (PTR-165 AC2)", () => {
    const first = request("rejected", "Old Hall");
    const second = request("released", "Suggested Hall", { replacesRequestId: first.id });

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("approved"), first, second],
        equipmentLines: [],
      })
    ).toEqual([
      "The booking request for Old Hall (1 Jan 2030, 09:00 – 12:30) was rejected.",
      "The booking for Suggested Hall (1 Jan 2030, 09:00 – 12:30) was released.",
    ]);
  });

  it("ignores a withdrawn replacer, so its predecessor stays unanswered (PTR-165 AC6)", () => {
    const rejected = request("rejected", "Old Hall");
    const withdrawn = request("withdrawn", "Suggested Hall", {
      replacesRequestId: rejected.id,
    });

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("approved"), rejected, withdrawn],
        equipmentLines: [],
      })
    ).toEqual(["The booking request for Old Hall (1 Jan 2030, 09:00 – 12:30) was rejected."]);
  });

  it("answers a released booking through its replacement at another venue (PTR-137, PTR-165)", () => {
    const released = request("released", "Blocked Hall");
    const replacement = request("approved", "Replacement Annex", {
      replacesRequestId: released.id,
    });

    // The Coordinator arranges the replacement after the booking, then releases the booking. The
    // replacement can sit at another venue, and the lift leaves both arrangements standing.
    expect(
      blockersFor({
        status: "planning",
        venueRequests: [released, replacement],
        equipmentLines: [],
      })
    ).toEqual([]);

    // Alone, the release stays outstanding until the Coordinator raises its replacement.
    expect(
      blockersFor({
        status: "planning",
        venueRequests: [released],
        equipmentLines: [],
      })
    ).toEqual([
      VENUE_BOOKING_OUTSTANDING_MESSAGE,
      "The booking for Blocked Hall (1 Jan 2030, 09:00 – 12:30) was released.",
    ]);
  });

  it("stops blocking a settled row the Coordinator dismissed (PTR-165 AC4)", () => {
    const dismissed = request("rejected", "Old Hall", { dismissedAt: BASE_TIME });

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("approved"), dismissed],
        equipmentLines: [],
      })
    ).toEqual([]);
  });

  it("does not let a dismissed replacer answer its predecessor (PTR-165 AC2)", () => {
    const rejected = request("rejected", "Old Hall");
    const dismissed = request("rejected", "Suggested Hall", {
      replacesRequestId: rejected.id,
      dismissedAt: BASE_TIME,
    });

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("approved"), rejected, dismissed],
        equipmentLines: [],
      })
    ).toEqual(["The booking request for Old Hall (1 Jan 2030, 09:00 – 12:30) was rejected."]);
  });

  it("keeps a pending request blocking beside a replacement of another row (PTR-165)", () => {
    const firstRejection = request("rejected", "Old Hall");
    const pending = request("pending", "Annex");
    const approvedReplacement = request("approved", "New Hall", {
      replacesRequestId: firstRejection.id,
    });

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [firstRejection, pending, approvedReplacement],
        equipmentLines: [],
      })
    ).toEqual(["The booking request for Annex (1 Jan 2030, 09:00 – 12:30) is still pending."]);
  });

  it("blocks a corrupt replacement cycle instead of clearing the gate (PTR-165 AC2)", () => {
    const first = request("rejected", "Old Hall");
    const second = request("rejected", "Annex", { replacesRequestId: first.id });
    // Point the first row back at the second. No handler writes this, but the index alone allows
    // it: both rows name a different request.
    const loop = { ...first, replacesRequestId: second.id };

    expect(
      blockersFor({
        status: "approved",
        venueRequests: [request("approved"), loop, second],
        equipmentLines: [],
      })
    ).toEqual([
      "The booking request for Old Hall (1 Jan 2030, 09:00 – 12:30) was rejected.",
      "The booking request for Annex (1 Jan 2030, 09:00 – 12:30) was rejected.",
    ]);
  });

  it("refuses an approved booking a venue block suspends (PTR-137)", () => {
    expect(
      blockersFor({
        status: "planning",
        venueRequests: approvedBooking,
        venueBookingSuspended: true,
        equipmentLines: settled,
      })
    ).toEqual([VENUE_BOOKING_SUSPENDED_MESSAGE]);
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
