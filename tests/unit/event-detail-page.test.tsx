import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EventProjection } from "#/features/events/access";
import type { EventPageData } from "#/features/events/page-data";
import { EventDetailPage } from "#/features/events/components/event-detail-page";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => <a href={params ? `${to}/${params["eventId"]}` : to}>{children}</a>,
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
}));
vi.mock("#/features/events/server-fns", () => ({
  registerForEvent: vi.fn<() => Promise<unknown>>(),
  withdrawFromEvent: vi.fn<() => Promise<unknown>>(),
}));

function projection(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]> = {}
): EventProjection {
  return {
    access,
    event: {
      id: 1042,
      name: "ConnectSphere Open Day",
      description: "An open day for new members.",
      eventDate: "2026-11-04",
      startTime: "10:00",
      endTime: "16:00",
      status: "confirmed",
      venue: {
        name: "Harbor Hall",
        location: "12 Dock Street",
        date: "2026-11-04",
        endDate: "2026-11-04",
        startTime: "10:00",
        endTime: "16:00",
      },
      ...event,
    },
  };
}

describe("EventDetailPage", () => {
  it("delegates an attendee to the unchanged attendee page with no section nav", () => {
    render(
      <EventDetailPage
        data={{
          kind: "event",
          viewerId: "viewer-1",
          event: projection("attendee", { registrationAvailability: { state: "open" } }),
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "ConnectSphere Open Day" })).toBeTruthy();
    expect(screen.getByText("An open day for new members.")).toBeTruthy();
  });

  it("renders the organiser staff header with the venue and the section nav", () => {
    const { container } = render(
      <EventDetailPage
        data={
          {
            kind: "event",
            viewerId: "viewer-1",
            event: projection("organiser", { expectedAttendance: 60 }),
            organiserRequest: {
              id: 1042,
              status: "confirmed",
              purpose: "Welcome new members.",
              proposedDates: [{ start: "2026-11-04T10:00", end: "2026-11-04T16:00" }],
              expectedAttendance: 60,
              description: "An open day for new members.",
              eventType: "Open day",
              venueRequirements: "Step-free access, PA system",
              roomLayoutPreference: "Mixed seating",
              accessibilityRequirements: "Step-free access throughout",
              equipmentRequirements: [],
              specialArrangements: "None",
              registrationEnabled: false,
              registrationCapacity: null,
              registrationOpensAt: null,
              registrationClosesAt: null,
              coordinator: { name: "Jonas Weber", email: "jonas@example.com" },
              clarifications: [],
              changeRequests: [],
              cancellationRequests: [],
              submittedAt: new Date("2026-09-20T00:00:00Z"),
              decidedAt: new Date("2026-09-28T09:41:00.000Z"),
              decidedByCoordinatorName: "Jonas Weber",
              decisionReason: null,
            },
          } as unknown as EventPageData
        }
      />
    );

    expect(screen.getByText("organiser access")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ConnectSphere Open Day" })).toBeTruthy();
    expect(screen.getByText("Harbor Hall")).toBeTruthy();
    expect(screen.getByText("4 Nov 2026")).toBeTruthy();
    expect(screen.getByText("10:00–16:00")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe(
      "/dashboard"
    );

    for (const id of ["venue", "registrations", "equipment", "requests", "details"]) {
      expect(container.querySelector(`#${id}`)).toBeTruthy();
    }
    expect(screen.queryByRole("complementary", { name: "Actions" })).toBeNull();
  });

  it("titles a venue staff event with the requested venue", () => {
    render(
      <EventDetailPage
        data={
          {
            kind: "event",
            event: projection("venue_staff", {
              venueRequest: { id: "vr-1", status: "pending", venueName: "Riverside Loft" },
            }),
            venueDecision: {
              request: {
                id: "vr-1",
                venueId: 3,
                venueName: "Riverside Loft",
                startsAt: "2026-11-21T18:00",
                endsAt: "2026-11-21T22:00",
                submittedAt: new Date("2026-10-14T01:00:00Z"),
                conflict: null,
                requirements: {
                  eventTiming: "21 Nov 2026, 18:00–22:00",
                  expectedAttendance: 120,
                  layout: "Cabaret",
                  accessibility: "Step-free entrance",
                  requiredFacilities: "6 power drops, WiFi",
                },
              },
              venues: [],
            },
          } as unknown as EventPageData
        }
      />
    );

    expect(screen.getByText("venue staff access")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Riverside Loft" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Booking request details" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Record a decision" })).toBeTruthy();
  });

  it("renders the technical support header without a venue row", () => {
    render(
      <EventDetailPage
        data={{
          kind: "event",
          viewerId: "viewer-1",
          event: projection("technical_support", { venue: undefined }),
        }}
      />
    );

    expect(screen.getByText("technical support access")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ConnectSphere Open Day" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Equipment lines" })).toBeTruthy();
    expect(screen.queryByText("Harbor Hall")).toBeNull();
  });

  it("falls back to Venue request when the event carries no name", () => {
    render(
      <EventDetailPage
        data={{
          kind: "event",
          viewerId: "viewer-1",
          event: projection("venue_staff", {
            venueRequest: { id: "vr-1", status: "pending" },
          }),
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Venue request" })).toBeTruthy();
  });

  it("renders the coordinator triage header from the coordination request", () => {
    render(
      <EventDetailPage
        data={
          {
            kind: "triage",
            request: {
              eventName: "Unassigned open day",
              status: "submitted",
              proposedDates: [{ start: "2026-11-04T10:00", end: "2026-11-04T16:00" }],
              assignedCoordinatorId: null,
              assignedAt: null,
              organiser: { name: "Sofia Andersson", email: "sofia.andersson@example.com" },
              equipmentRequirements: [],
              clarifications: [],
              cancellationRequests: [],
              changeRequests: [],
              outstandingReleases: null,
              pendingHandover: null,
            },
            coordinators: [],
          } as unknown as EventPageData
        }
      />
    );

    expect(screen.getByText("coordinator access")).toBeTruthy();
    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Unassigned open day" })).toBeTruthy();
  });

  it("rails the triage assignment beside the record", () => {
    const { container } = render(
      <EventDetailPage
        data={
          {
            kind: "triage",
            request: {
              eventName: "Unassigned open day",
              status: "submitted",
              proposedDates: [{ start: "2026-11-04T10:00", end: "2026-11-04T16:00" }],
              assignedCoordinatorId: null,
              assignedAt: null,
              organiser: { name: "Sofia Andersson", email: "sofia.andersson@example.com" },
              coordinator: null,
              pendingHandover: null,
              equipmentRequirements: [],
              clarifications: [],
              cancellationRequests: [],
              changeRequests: [],
              outstandingReleases: null,
            },
            coordinators: [],
          } as unknown as EventPageData
        }
      />
    );

    const rail = screen.getByRole("complementary", { name: "Actions" });
    expect(rail.querySelector("#assignment")).toBeTruthy();
    expect(container.querySelector("main #request")).toBeTruthy();
    expect(container.querySelector("main aside #assignment")).toBe(
      rail.querySelector("#assignment")
    );
  });
});
