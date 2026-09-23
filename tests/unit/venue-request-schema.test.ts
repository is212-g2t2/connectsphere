import { describe, expect, it } from "vitest";

import {
  VENUE_REQUEST_DATE_MESSAGE,
  VENUE_REQUEST_ID_MESSAGE,
  VENUE_REQUEST_TIME_MESSAGE,
  VENUE_REQUEST_TIME_ORDER_MESSAGE,
  VenueRequestInput,
  parseVenueRequestContext,
  parseVenueRequestId,
  parseVenueRequestInput,
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
