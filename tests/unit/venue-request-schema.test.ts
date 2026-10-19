import { describe, expect, it } from "vitest";

import {
  INITIAL_ROOM_LAYOUTS,
  LAYOUT_MESSAGE,
  VENUE_ID_MESSAGE,
  VENUE_SEARCH_ATTENDANCE_MESSAGE,
  VENUE_SEARCH_TEXT_MAX_LENGTH,
} from "#/features/venues/schema";
import {
  VENUE_REJECTION_REASON_MAX_LENGTH,
  VENUE_REJECTION_REASON_REQUIRED,
  VENUE_RELEASE_REASON_MAX_LENGTH,
  VENUE_RELEASE_REASON_REQUIRED,
  VENUE_REJECTION_TIME_PAIR_MESSAGE,
  VENUE_REQUEST_DATE_MESSAGE,
  VENUE_REQUEST_ID_MESSAGE,
  VENUE_REQUEST_TIME_MESSAGE,
  VENUE_REQUEST_TIME_ORDER_MESSAGE,
  VenueRejectionInput,
  VenueAmendmentInput,
  VenueReleaseInput,
  VenueRequestInput,
  createVenueHoldConversionInput,
  createVenueRequestInput,
  parseVenueHoldConversion,
  parseVenueRejectionInput,
  parseVenueRequestContext,
  parseVenueRequestId,
  parseVenueRequestInput,
  venueHoldConflictMessage,
  venueRequestConflictMessage,
} from "#/features/venue-requests/schema";

const VALID = {
  eventId: 12,
  venueId: 3,
  date: "2026-10-12",
  startTime: "14:30",
  endTime: "18:45",
};

function firstIssue(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? undefined : result.error?.issues[0].message;
}

describe("VenueRequestInput (PTR-31 criterion 1)", () => {
  it("accepts an event, a venue, a date and an ordered start/end pair", () => {
    expect(VenueRequestInput.parse(VALID)).toEqual(VALID);
  });

  it("refuses a missing or malformed date", () => {
    expect(firstIssue(VenueRequestInput.safeParse({ ...VALID, date: "" }))).toBe(
      VENUE_REQUEST_DATE_MESSAGE
    );
    expect(firstIssue(VenueRequestInput.safeParse({ ...VALID, date: "2026-02-30" }))).toBe(
      VENUE_REQUEST_DATE_MESSAGE
    );
  });

  it("refuses a malformed start or end time", () => {
    expect(firstIssue(VenueRequestInput.safeParse({ ...VALID, startTime: "9am" }))).toBe(
      VENUE_REQUEST_TIME_MESSAGE
    );
    expect(firstIssue(VenueRequestInput.safeParse({ ...VALID, endTime: "24:00" }))).toBe(
      VENUE_REQUEST_TIME_MESSAGE
    );
  });

  it("refuses an end that is not later than the start, on the same civil day", () => {
    expect(firstIssue(VenueRequestInput.safeParse({ ...VALID, endTime: "14:30" }))).toBe(
      VENUE_REQUEST_TIME_ORDER_MESSAGE
    );
    expect(firstIssue(VenueRequestInput.safeParse({ ...VALID, endTime: "13:00" }))).toBe(
      VENUE_REQUEST_TIME_ORDER_MESSAGE
    );
  });

  it("refuses ids that are not positive whole numbers", () => {
    expect(VenueRequestInput.safeParse({ ...VALID, eventId: "12" }).success).toBe(false);
    expect(VenueRequestInput.safeParse({ ...VALID, venueId: -1 }).success).toBe(false);
    expect(VenueRequestInput.safeParse({ ...VALID, venueId: 1.5 }).success).toBe(false);
  });

  it("accepts the request that this one replaces, and refuses a blank one (PTR-165 AC1)", () => {
    expect(VenueRequestInput.parse({ ...VALID, replacesRequestId: "rejected-1" })).toEqual({
      ...VALID,
      replacesRequestId: "rejected-1",
    });
    expect(VenueRequestInput.parse(VALID)).toEqual(VALID);
    expect(VenueRequestInput.safeParse({ ...VALID, replacesRequestId: "  " }).success).toBe(false);
    expect(VenueRequestInput.safeParse({ ...VALID, replacesRequestId: 7 }).success).toBe(false);
  });
});

describe("session requirements on a request (PTR-138 AC1)", () => {
  it("accepts and trims the four session requirements", () => {
    expect(
      VenueRequestInput.parse({
        ...VALID,
        expectedAttendance: 30,
        layout: " Boardroom ",
        accessibilityRequirements: " Hearing loop ",
        requiredFacilities: "",
      })
    ).toEqual({
      ...VALID,
      expectedAttendance: 30,
      layout: "Boardroom",
      accessibilityRequirements: "Hearing loop",
      requiredFacilities: "",
    });
  });

  it("accepts a blank layout, which states no layout", () => {
    expect(VenueRequestInput.parse({ ...VALID, layout: "  " })).toMatchObject({ layout: "" });
  });

  it("leaves layout text to the handler, which refuses a layout that names no layout", () => {
    expect(VenueRequestInput.safeParse({ ...VALID, layout: "Round tables" }).success).toBe(true);
    expect(
      firstIssue(
        createVenueRequestInput(INITIAL_ROOM_LAYOUTS).safeParse({
          ...VALID,
          layout: "Round tables",
        })
      )
    ).toBe(LAYOUT_MESSAGE);
    expect(
      createVenueRequestInput(INITIAL_ROOM_LAYOUTS).parse({ ...VALID, layout: "Boardroom seating" })
    ).toMatchObject({ layout: "Boardroom seating" });
  });

  it.each([0, -5, 2.5, 3_000_000_000, "30"])("refuses an attendance of %j", attendance => {
    expect(
      firstIssue(VenueRequestInput.safeParse({ ...VALID, expectedAttendance: attendance }))
    ).toBe(VENUE_SEARCH_ATTENDANCE_MESSAGE);
  });

  it("bounds each text requirement at the search's length", () => {
    const long = "a".repeat(VENUE_SEARCH_TEXT_MAX_LENGTH + 1);
    expect(VenueRequestInput.safeParse({ ...VALID, requiredFacilities: long }).success).toBe(false);
    expect(
      VenueRequestInput.safeParse({
        ...VALID,
        accessibilityRequirements: "a".repeat(VENUE_SEARCH_TEXT_MAX_LENGTH),
      }).success
    ).toBe(true);
  });

  it("gives a hold conversion the same optional session requirements", () => {
    expect(parseVenueHoldConversion({ id: "hold-1" })).toEqual({ id: "hold-1" });
    expect(parseVenueHoldConversion({ id: "hold-1", expectedAttendance: 30 })).toEqual({
      id: "hold-1",
      expectedAttendance: 30,
    });
    expect(parseVenueHoldConversion({ id: "hold-1", layout: "Round tables" })).toMatchObject({
      id: "hold-1",
    });
    expect(() =>
      createVenueHoldConversionInput(INITIAL_ROOM_LAYOUTS).parse({
        id: "hold-1",
        layout: "Round tables",
      })
    ).toThrow(LAYOUT_MESSAGE);
  });
});

describe("venue request ids (PTR-31 criterion 5)", () => {
  it("accepts a generated id and the seed's fixture spelling", () => {
    expect(parseVenueRequestId({ id: "1b3d5f70-0000-4000-8000-000000000000" }).id).toBe(
      "1b3d5f70-0000-4000-8000-000000000000"
    );
    expect(parseVenueRequestId({ id: "demo-venue-request-1" }).id).toBe("demo-venue-request-1");
  });

  it("refuses an empty or whitespace-only id", () => {
    expect(() => parseVenueRequestId({ id: "  " })).toThrow(VENUE_REQUEST_ID_MESSAGE);
    expect(() => parseVenueRequestId({})).toThrow(VENUE_REQUEST_ID_MESSAGE);
  });
});

describe("venueRequestConflictMessage (PTR-36 criterion 2)", () => {
  it("names the venue and the conflicting period, and never the other event", () => {
    expect(
      venueRequestConflictMessage({
        venueName: "Harbour Hall",
        startsAt: "2027-06-01T09:00:00",
        endsAt: "2027-06-01T12:30:00",
      })
    ).toBe("Harbour Hall is already booked 1 Jun 2027, 09:00 – 12:30");
  });

  it("names the end date too when the period crosses midnight", () => {
    expect(
      venueRequestConflictMessage({
        venueName: "Harbour Hall",
        startsAt: "2027-06-01T22:00:00",
        endsAt: "2027-06-02T01:00:00",
      })
    ).toBe("Harbour Hall is already booked 1 Jun 2027, 22:00 – 2 Jun 2027, 01:00");
  });
});

describe("venueHoldConflictMessage (PTR-109 AC2)", () => {
  it("names the venue and the conflicting period as tentatively held", () => {
    expect(
      venueHoldConflictMessage({
        venueName: "Harbour Hall",
        startsAt: "2027-06-01T09:00:00",
        endsAt: "2027-06-01T12:30:00",
      })
    ).toBe("Harbour Hall is tentatively held 1 Jun 2027, 09:00 – 12:30");
  });

  it("handles space-separated database timestamps", () => {
    expect(
      venueHoldConflictMessage({
        venueName: "Harbour Hall",
        startsAt: "2027-06-01 09:00:00",
        endsAt: "2027-06-01 12:30:00",
      })
    ).toBe("Harbour Hall is tentatively held 1 Jun 2027, 09:00 – 12:30");
  });

  it("names the end date too when the hold crosses midnight", () => {
    expect(
      venueHoldConflictMessage({
        venueName: "Harbour Hall",
        startsAt: "2027-06-01T22:00:00",
        endsAt: "2027-06-02T01:00:00",
      })
    ).toBe("Harbour Hall is tentatively held 1 Jun 2027, 22:00 – 2 Jun 2027, 01:00");
  });
});

describe("venue request context selection", () => {
  it("parses a complete selection", () => {
    expect(parseVenueRequestContext({ eventId: 4, venueId: 7 })).toEqual({
      eventId: 4,
      venueId: 7,
    });
  });

  it("rethrows the first readable refusal for the server-function boundary", () => {
    expect(() => parseVenueRequestInput({ ...VALID, date: "" })).toThrow(
      VENUE_REQUEST_DATE_MESSAGE
    );
    expect(() => parseVenueRequestContext({ eventId: 0, venueId: 7 })).toThrow("Choose an event");
  });
});

describe("VenueRejectionInput (PTR-34 criteria 1 and 2)", () => {
  const REJECT = { id: "request-1", reason: "Closed for floor resurfacing" };

  it("accepts a reason alone and trims it", () => {
    expect(VenueRejectionInput.parse(REJECT)).toEqual(REJECT);
    expect(VenueRejectionInput.parse({ ...REJECT, reason: "  Too small  " }).reason).toBe(
      "Too small"
    );
  });

  it("refuses a missing, empty or whitespace-only reason", () => {
    for (const reason of [undefined, "", "   "]) {
      expect(firstIssue(VenueRejectionInput.safeParse({ id: REJECT.id, reason }))).toBe(
        VENUE_REJECTION_REASON_REQUIRED
      );
    }
  });

  it("bounds the reason at 2,000 characters", () => {
    const at = "a".repeat(VENUE_REJECTION_REASON_MAX_LENGTH);
    expect(VenueRejectionInput.safeParse({ ...REJECT, reason: at }).success).toBe(true);
    expect(firstIssue(VenueRejectionInput.safeParse({ ...REJECT, reason: `${at}a` }))).toBe(
      `Rejection reason must be ${VENUE_REJECTION_REASON_MAX_LENGTH} characters or fewer`
    );
  });

  it("accepts a full suggestion, and any part of one alone", () => {
    const full = {
      suggestedVenueId: 4,
      suggestedDate: "2027-04-21",
      suggestedStartTime: "10:00",
      suggestedEndTime: "13:30",
    };
    expect(VenueRejectionInput.parse({ ...REJECT, ...full })).toEqual({ ...REJECT, ...full });
    for (const part of [
      { suggestedVenueId: 4 },
      { suggestedDate: "2027-04-21" },
      { suggestedStartTime: "10:00", suggestedEndTime: "13:30" },
    ]) {
      expect(VenueRejectionInput.parse({ ...REJECT, ...part })).toEqual({ ...REJECT, ...part });
    }
  });

  it("refuses a start time without an end time, and the reverse", () => {
    expect(
      firstIssue(VenueRejectionInput.safeParse({ ...REJECT, suggestedStartTime: "10:00" }))
    ).toBe(VENUE_REJECTION_TIME_PAIR_MESSAGE);
    expect(
      firstIssue(VenueRejectionInput.safeParse({ ...REJECT, suggestedEndTime: "10:00" }))
    ).toBe(VENUE_REJECTION_TIME_PAIR_MESSAGE);
  });

  it("refuses a suggested end that is not later than the start", () => {
    for (const suggestedEndTime of ["14:00", "13:00"]) {
      expect(
        firstIssue(
          VenueRejectionInput.safeParse({
            ...REJECT,
            suggestedStartTime: "14:00",
            suggestedEndTime,
          })
        )
      ).toBe(VENUE_REQUEST_TIME_ORDER_MESSAGE);
    }
  });

  it("refuses a malformed suggested date, time or venue", () => {
    expect(
      firstIssue(VenueRejectionInput.safeParse({ ...REJECT, suggestedDate: "2027-02-30" }))
    ).toBe(VENUE_REQUEST_DATE_MESSAGE);
    expect(
      firstIssue(
        VenueRejectionInput.safeParse({
          ...REJECT,
          suggestedStartTime: "25:00",
          suggestedEndTime: "26:00",
        })
      )
    ).toBe(VENUE_REQUEST_TIME_MESSAGE);
    for (const suggestedVenueId of [0, -1, 1.5]) {
      expect(firstIssue(VenueRejectionInput.safeParse({ ...REJECT, suggestedVenueId }))).toBe(
        VENUE_ID_MESSAGE
      );
    }
  });

  it("rethrows the first readable refusal for the server-function boundary", () => {
    expect(() => parseVenueRejectionInput({ id: REJECT.id })).toThrow(
      VENUE_REJECTION_REASON_REQUIRED
    );
    expect(parseVenueRejectionInput(REJECT)).toEqual(REJECT);
  });
});

describe("PTR-37 booking mutation inputs", () => {
  const release = { id: "approved-1", reason: "Air-conditioning failure" };
  const amendment = {
    id: "approved-1",
    venueId: 3,
    date: "2027-04-21",
    startTime: "10:00",
    endTime: "13:30",
  };

  it("accepts and trims a release reason", () => {
    expect(VenueReleaseInput.parse({ ...release, reason: "  Air-conditioning failure  " })).toEqual(
      {
        ...release,
        reason: "Air-conditioning failure",
      }
    );
  });

  it("requires a non-blank release reason and caps its length", () => {
    for (const reason of [undefined, "", "   "]) {
      expect(firstIssue(VenueReleaseInput.safeParse({ id: release.id, reason }))).toBe(
        VENUE_RELEASE_REASON_REQUIRED
      );
    }
    const at = "a".repeat(VENUE_RELEASE_REASON_MAX_LENGTH);
    expect(VenueReleaseInput.safeParse({ ...release, reason: at }).success).toBe(true);
    expect(firstIssue(VenueReleaseInput.safeParse({ ...release, reason: `${at}a` }))).toBe(
      `Release reason must be ${VENUE_RELEASE_REASON_MAX_LENGTH} characters or fewer`
    );
  });

  it("accepts an ordered amendment and rejects an invalid window", () => {
    expect(VenueAmendmentInput.parse(amendment)).toEqual(amendment);
    expect(firstIssue(VenueAmendmentInput.safeParse({ ...amendment, endTime: "10:00" }))).toBe(
      VENUE_REQUEST_TIME_ORDER_MESSAGE
    );
  });
});
