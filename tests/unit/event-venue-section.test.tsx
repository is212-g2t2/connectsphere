import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EventProjection } from "#/features/events/access";
import { venueSections } from "#/features/events/components/venue-section";
import type { EventPageData } from "#/features/events/page-data";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, unknown>;
    params?: Record<string, unknown>;
    className?: string;
  }) => (
    <a href={to} data-search={JSON.stringify(search ?? null)}>
      {children}
    </a>
  ),
}));

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
      expectedAttendance: 60,
      ...event,
    },
  };
}

function eventData(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]>
): EventPageData {
  return {
    kind: "event",
    viewerId: "viewer-1",
    event: projection(access, event),
  };
}

function renderVenue(access: EventProjection["access"], event: Partial<EventProjection["event"]>) {
  const data = eventData(access, event);
  const defs = venueSections(data);
  expect(defs).toHaveLength(1);
  render(<>{defs[0].render(data)}</>);
}

function isVenueVisible(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]>
): boolean {
  const data = eventData(access, event);
  return venueSections(data).some(section => section.visible(data));
}

const rejectedVenueRequest = {
  id: "vr-1",
  status: "rejected",
  rejection: {
    venueId: 3,
    venueName: "Harbor Hall",
    date: "2026-12-05",
    startTime: "17:00",
    endTime: "21:00",
    reason: "The main hall is being rewired that weekend.",
    suggestion: null,
    suggestedVenueId: null,
  },
} as const;

describe("venue section", () => {
  it("shows the confirmed booking for the organiser", () => {
    renderVenue("organiser", {
      confirmation: {
        confirmedAt: "2026-09-28T09:41:00.000Z",
        confirmedByName: "Jonas Weber",
        venue: {
          name: "Harbor Hall, 12 Dock Street",
          location: "12 Dock Street",
          date: "2026-11-04",
          endDate: "2026-11-04",
          startTime: "10:00",
          endTime: "16:00",
        },
      },
    });

    expect(screen.getByText("Harbor Hall, 12 Dock Street")).toBeTruthy();
    expect(screen.getByText(/Jonas Weber/)).toBeTruthy();
  });

  it("shows the pending venue request with its conflict", () => {
    renderVenue("coordinator", {
      status: "planning",
      venueRequest: { id: "vr-1", status: "pending", conflict: "booking" },
    });

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Conflicting booking")).toBeTruthy();
  });

  it("offers the adjust-request link to the coordinator on a rejected submitted request", () => {
    renderVenue("coordinator", { status: "submitted", venueRequest: { ...rejectedVenueRequest } });

    expect(screen.getByText("The main hall is being rewired that weekend.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Adjust request at Harbor Hall" })).toBeTruthy();
  });

  it("keeps review statuses mounted for the coordinator search, and for the organiser only while a rejected request waits", () => {
    for (const status of ["submitted", "under_review", "awaiting_organiser"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(true);
      expect(isVenueVisible("organiser", { status })).toBe(false);
    }
    expect(
      isVenueVisible("coordinator", {
        status: "submitted",
        venueRequest: { ...rejectedVenueRequest },
      })
    ).toBe(true);
    expect(
      isVenueVisible("organiser", {
        status: "submitted",
        venueRequest: { ...rejectedVenueRequest },
      })
    ).toBe(true);
  });

  it("always shows approved, planning and confirmed events", () => {
    for (const status of ["approved", "planning", "confirmed"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(true);
      expect(isVenueVisible("organiser", { status })).toBe(true);
    }
  });

  it("hides rejected, cancelled and completed events", () => {
    for (const status of ["rejected", "cancelled", "completed"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(false);
      expect(isVenueVisible("organiser", { status })).toBe(false);
    }
  });

  it("shows the triage venue with the rejected booking and the adjust link", () => {
    const data = {
      kind: "triage",
      viewerId: "viewer-1",
      request: {
        id: 1036,
        status: "submitted",
        expectedAttendance: 60,
        roomLayoutPreference: "Workshop rows",
        accessibilityRequirements: "",
        venueRequirements: "10 power sockets, whiteboards",
        venueRequest: { ...rejectedVenueRequest },
      },
      coordinators: [],
    } as unknown as EventPageData;
    const defs = venueSections(data);
    expect(defs).toHaveLength(1);
    expect(defs[0].visible(data)).toBe(true);
    render(<>{defs[0].render(data)}</>);

    expect(screen.getByRole("heading", { name: "Venue" })).toBeTruthy();
    expect(screen.getByText("The main hall is being rewired that weekend.")).toBeTruthy();
    expect(screen.getByText("Harbor Hall, 5 Dec 2026, 17:00–21:00")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Adjust request at Harbor Hall" })).toBeTruthy();
  });

  it("hides the triage venue without a venue request", () => {
    const data = {
      kind: "triage",
      viewerId: "viewer-1",
      request: { id: 1036, status: "submitted", venueRequest: null },
      coordinators: [],
    } as unknown as EventPageData;

    expect(venueSections(data).some(section => section.visible(data))).toBe(false);
  });

  it("hides the adjust-request link from the organiser", () => {
    renderVenue("organiser", { status: "submitted", venueRequest: { ...rejectedVenueRequest } });

    expect(screen.queryByRole("link", { name: /Adjust request/ })).toBeNull();
  });

  it("offers the venue search to the coordinator while the event is searchable", () => {
    renderVenue("coordinator", { status: "planning" });

    expect(screen.getByRole("link", { name: "Find venues for this event" })).toBeTruthy();
  });

  it("hides the venue search from the organiser", () => {
    renderVenue("organiser", { status: "planning" });

    expect(screen.queryByRole("link", { name: "Find venues for this event" })).toBeNull();
  });
});
