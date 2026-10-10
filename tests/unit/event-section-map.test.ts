import { describe, expect, it } from "vitest";

import type { EventProjection } from "#/features/events/access";
import type { EventPageData } from "#/features/events/page-data";
import { eventSections, railSectionIds } from "#/features/events/components/event-detail-page";

function projection(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]> = {}
): EventProjection {
  return {
    access,
    event: {
      id: 1042,
      eventDate: "2026-11-04",
      startTime: "10:00",
      endTime: "16:00",
      status: "confirmed",
      ...event,
    },
  };
}

function page(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]> = {}
): EventPageData {
  return { kind: "event", event: projection(access, event), viewerId: "viewer-1" };
}

function ids(data: EventPageData): string[] {
  return eventSections(data).map(section => section.id);
}

describe("eventSections", () => {
  it("returns no sections for an attendee", () => {
    expect(ids(page("attendee"))).toEqual([]);
  });

  it("lists the organiser sections in order for a confirmed event", () => {
    const data = {
      kind: "event",
      event: projection("organiser", { name: "Open Day", expectedAttendance: 60 }),
      viewerId: "viewer-1",
      organiserRequest: { status: "confirmed" },
    } as unknown as EventPageData;
    expect(ids(data)).toEqual([
      "venue",
      "registrations",
      "equipment",
      "decision",
      "requests",
      "details",
    ]);
  });

  it("hides venue, registrations and equipment from a submitted organiser event", () => {
    const data = {
      kind: "event",
      event: projection("organiser", { status: "submitted" }),
      viewerId: "viewer-1",
      organiserRequest: { status: "submitted" },
    } as unknown as EventPageData;
    expect(ids(data)).toEqual(["requests", "details"]);
  });

  it("shows the recorded decision for a decided organiser event", () => {
    const data = {
      kind: "event",
      event: projection("organiser", { status: "rejected" }),
      viewerId: "viewer-1",
      organiserRequest: { status: "rejected" },
    } as unknown as EventPageData;

    expect(ids(data)).toEqual(["decision", "requests", "details"]);
  });

  it("hides registrations from a submitted organiser event even with attendees loaded", () => {
    const data: EventPageData = {
      kind: "event",
      event: projection("organiser", { status: "submitted" }),
      viewerId: "viewer-1",
      attendees: [],
    };

    expect(ids(data)).not.toContain("registrations");
  });

  it("shows the review and assignment sections for a submitted coordinator event", () => {
    const found = ids(page("coordinator", { status: "submitted" }));

    expect(found).toContain("review");
    expect(found).not.toContain("messages");
    expect(found).not.toContain("changes");
    expect(found).toContain("assignment");
    expect(found).not.toContain("confirm");
    expect(found).not.toContain("releases");
  });

  it("shows the thread and change sections once history exists", () => {
    const data = {
      kind: "event",
      event: projection("coordinator", { status: "under_review" }),
      viewerId: "viewer-1",
      coordination: {
        request: {
          clarifications: [{ id: 11 }],
          changeRequests: [{ id: 3 }],
          cancellationRequests: [],
        },
        coordinators: [],
      },
    } as unknown as EventPageData;
    const found = ids(data);

    expect(found).toContain("messages");
    expect(found).toContain("changes");
  });

  it("keeps the venue block mounted for a searchable coordinator event with no request", () => {
    for (const status of ["submitted", "under_review", "awaiting_organiser"] as const) {
      expect(ids(page("coordinator", { status }))).toContain("venue");
    }
  });

  it("hides the venue block from an organiser event still in review", () => {
    expect(ids(page("organiser", { status: "submitted" }))).not.toContain("venue");
  });

  it("hides the venue block from a bare settled organiser event", () => {
    expect(ids(page("organiser", { status: "confirmed" }))).not.toContain("venue");
  });

  it("shows confirm and update sections for a planning coordinator event", () => {
    const data = {
      kind: "event",
      event: projection("coordinator", { status: "planning" }),
      viewerId: "viewer-1",
      coordination: { request: {}, coordinators: [] },
    } as unknown as EventPageData;
    const found = ids(data);

    expect(found).toContain("confirm");
    expect(found).toContain("details");
    expect(found).not.toContain("review");
    expect(found).not.toContain("releases");
  });

  it("shows the releases section for a cancelled coordinator event", () => {
    const data = {
      kind: "event",
      event: projection("coordinator", { status: "cancelled" }),
      viewerId: "viewer-1",
      coordination: {
        request: {
          clarifications: [],
          changeRequests: [],
          cancellationRequests: [],
          outstandingReleases: {
            venueBookings: [],
            venueHolds: [],
            equipmentReservations: [],
          },
        },
        coordinators: [],
      },
    } as unknown as EventPageData;
    const found = ids(data);

    expect(found).toContain("releases");
    expect(found).not.toContain("review");
    expect(found).not.toContain("confirm");
  });

  it("hides the releases section when nothing is still held", () => {
    const data = {
      kind: "event",
      event: projection("coordinator", { status: "cancelled" }),
      viewerId: "viewer-1",
      coordination: {
        request: {
          clarifications: [],
          changeRequests: [],
          cancellationRequests: [],
          outstandingReleases: null,
        },
        coordinators: [],
      },
    } as unknown as EventPageData;

    expect(ids(data)).not.toContain("releases");
    expect(ids(page("coordinator", { status: "cancelled" }))).not.toContain("releases");
  });

  it("shows the complete section for a confirmed coordinator event", () => {
    const found = ids(page("coordinator", { status: "confirmed" }));

    expect(found).toContain("complete");
    expect(found).not.toContain("confirm");
    expect(found).not.toContain("releases");
  });

  it("renders complete last, after the event-information section", () => {
    const data = {
      kind: "event",
      event: projection("coordinator", { status: "confirmed" }),
      viewerId: "viewer-1",
      coordination: { request: {}, coordinators: [] },
    } as unknown as EventPageData;
    const found = ids(data);

    expect(found.at(-1)).toBe("complete");
    expect(found.indexOf("details")).toBeLessThan(found.indexOf("complete"));
  });

  it("shows the cancellation section only while a cancellation request waits", () => {
    const waiting = {
      kind: "event",
      event: projection("coordinator", { status: "confirmed" }),
      coordination: {
        request: { cancellationRequests: [{ outcome: null }] },
        coordinators: [],
      },
    } as unknown as EventPageData;
    const settled = {
      kind: "event",
      event: projection("coordinator", { status: "confirmed" }),
      coordination: {
        request: { cancellationRequests: [{ outcome: "approved" }] },
        coordinators: [],
      },
    } as unknown as EventPageData;

    expect(ids(waiting)).toContain("cancellation");
    expect(ids(settled)).not.toContain("cancellation");
  });

  it("shows request and decision sections for a pending venue staff event", () => {
    expect(
      ids({
        kind: "event",
        event: projection("venue_staff", {
          venueRequest: { id: "vr-1", status: "pending", venueName: "Harbor Hall" },
        }),
        venueDecision: { request: {}, venues: [] },
      } as unknown as EventPageData)
    ).toEqual(["request", "decision"]);
  });

  it("shows only the request details once the venue staff decision is recorded", () => {
    expect(
      ids({
        kind: "event",
        viewerId: "viewer-1",
        event: projection("venue_staff", {
          venueRequest: { id: "vr-1", status: "approved", venueName: "Harbor Hall" },
        }),
      })
    ).toEqual(["request"]);
  });

  it("lists the technical support sections in order", () => {
    expect(ids(page("technical_support", { name: "Open Day" }))).toEqual([
      "lines",
      "arrangements",
      "availability",
    ]);
  });

  it("lists the coordinator triage sections for an unassigned request", () => {
    const found = ids({
      kind: "triage",
      request: {
        status: "submitted",
        cancellationRequests: [],
        changeRequests: [],
      },
      coordinators: [],
    } as unknown as EventPageData);

    expect(found).toContain("request");
    expect(found).toContain("assignment");
    expect(found).not.toContain("review");
    expect(found).not.toContain("confirm");
  });
});

describe("railSectionIds", () => {
  it("rails the coordinator's compact actions", () => {
    expect([...railSectionIds(page("coordinator", { status: "confirmed" }))]).toEqual([
      "assignment",
      "cancellation",
      "confirm",
      "complete",
    ]);
  });

  it("rails only the assignment in triage", () => {
    const data = {
      kind: "triage",
      request: { status: "submitted" },
      coordinators: [],
    } as unknown as EventPageData;

    expect([...railSectionIds(data)]).toEqual(["assignment"]);
  });

  it("rails the venue staff decision", () => {
    expect([...railSectionIds(page("venue_staff"))]).toEqual(["decision"]);
  });

  it("keeps the organiser and technical support views single-column", () => {
    expect(railSectionIds(page("organiser")).size).toBe(0);
    expect(railSectionIds(page("technical_support")).size).toBe(0);
  });
});
