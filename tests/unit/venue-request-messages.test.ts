import { describe, expect, it } from "vitest";

import {
  venueRequestEventOverlapMessage,
  venueRequestEventStatusMessage,
  venueRequirementsMessage,
  venueUnavailableMessage,
} from "#/features/venue-requests/requests.server";

/** PTR-138: the refusals that request creation and approval give, in plain words. */
describe("venue request refusals (PTR-138)", () => {
  it("names the venue and every failed session requirement in one refusal (AC1)", () => {
    expect(
      venueRequirementsMessage("Room B", ["Holds 40; 120 needed", "Missing facilities: projector"])
    ).toBe(
      "Room B does not meet this session's requirements: Holds 40; 120 needed. Missing facilities: projector."
    );
  });

  it("names the venue and why it cannot host the window (AC1)", () => {
    expect(venueUnavailableMessage("Room B", "Not open 07:00–09:00 on 2027-04-20")).toBe(
      "Room B cannot host this window: Not open 07:00–09:00 on 2027-04-20."
    );
  });

  it("names the event status in the badge's words", () => {
    expect(venueRequestEventStatusMessage("confirmed")).toBe(
      "This event is confirmed, so it cannot take a new venue booking."
    );
    expect(venueRequestEventStatusMessage("rejected")).toBe(
      "This event is rejected, so it cannot take a new venue booking."
    );
  });

  it("names the overlapping session of the same event, and the buffers when they count (AC4)", () => {
    const overlap = {
      venueName: "Harbour Hall",
      startsAt: "2027-06-01 09:00:00",
      endsAt: "2027-06-01 10:00:00",
    };
    expect(
      venueRequestEventOverlapMessage({ ...overlap, status: "pending", buffered: false })
    ).toBe(
      "This window overlaps this event's pending request for Harbour Hall on 1 Jun 2027, 09:00 – 10:00."
    );
    expect(
      venueRequestEventOverlapMessage({ ...overlap, status: "approved", buffered: true })
    ).toBe(
      "This window overlaps this event's approved booking for Harbour Hall on 1 Jun 2027, 09:00 – 10:00, including the venue's setup and turnaround time."
    );
  });
});
