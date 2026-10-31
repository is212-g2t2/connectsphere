// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

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

// Load the staff module before tests start so its first transform uses the hook timeout.
beforeAll(async () => {
  await import("#/features/events/components/event-staff-page");
}, 30_000);

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
          event: projection("attendee", { registrationAvailability: { state: "open" } }),
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "ConnectSphere Open Day" })).toBeTruthy();
    expect(screen.getByText("An open day for new members.")).toBeTruthy();
  });

  it("renders the organiser staff header with the venue and the section nav", async () => {
    const { container } = render(
      <EventDetailPage
        data={
          {
            kind: "event",
            event: projection("organiser", {
              expectedAttendance: 60,
              confirmation: {
                confirmedAt: "2026-09-28T09:41:00.000Z",
                confirmedByName: "Jonas Weber",
                venue: {
                  name: "Harbor Hall",
                  location: "12 Dock Street",
                  date: "2026-11-04",
                  endDate: "2026-11-04",
                  startTime: "10:00",
                  endTime: "16:00",
                },
              },
            }),
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

    expect(screen.queryByText("organiser access")).toBeNull();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ConnectSphere Open Day" })).toBeTruthy();
    expect(screen.getByText("Harbor Hall")).toBeTruthy();
    expect(screen.getByText("4 Nov 2026")).toBeTruthy();
    expect(screen.getByText("10:00–16:00")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe(
      "/dashboard"
    );

    // Wait for the sections behind the header before reading their anchors.
    await screen.findByRole("heading", { name: "Registrations" });
    for (const id of ["venue", "registrations", "equipment", "requests", "details"]) {
      expect(container.querySelector(`#${id}`)).toBeTruthy();
    }
    expect(screen.queryByRole("complementary", { name: "Actions" })).toBeNull();
  });

  it.each([
    ["approved", "Safety approved"],
    ["planning", "Safety rejected"],
    ["planning", "Safety changes requested"],
    ["approved", "Awaiting safety review"],
  ] as const)("shows the safety stage instead of the status on a %s event", (status, label) => {
    render(
      <EventDetailPage
        data={{
          kind: "event",
          event: projection("coordinator", {
            status,
            safetyStage: {
              state:
                label === "Safety approved"
                  ? "approved"
                  : label === "Safety rejected"
                    ? "rejected"
                    : label === "Safety changes requested"
                      ? "changes_requested"
                      : "pending",
              current: true,
            },
          }),
        }}
      />
    );

    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(status === "approved" ? "Approved" : "Planning")).toBeNull();
  });

  it("reads a review that no longer covers the arrangements as out of date", () => {
    render(
      <EventDetailPage
        data={{
          kind: "event",
          event: projection("organiser", {
            status: "planning",
            safetyStage: { state: "approved", current: false },
          }),
        }}
      />
    );

    expect(screen.getByText("Safety review out of date")).toBeTruthy();
    expect(screen.queryByText("Planning")).toBeNull();
  });

  it("keeps the plain status before the first review and once the event is confirmed", () => {
    const { rerender } = render(
      <EventDetailPage
        data={{ kind: "event", event: projection("organiser", { status: "approved" }) }}
      />
    );
    expect(screen.getByText("Approved")).toBeTruthy();

    rerender(
      <EventDetailPage
        data={{
          kind: "event",
          event: projection("coordinator", {
            status: "confirmed",
            safetyStage: { state: "rejected", current: true },
          }),
        }}
      />
    );
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.queryByText("Safety rejected")).toBeNull();
  });

  it("keeps the plain status on a Lead's page, which has no safety stage", () => {
    render(
      <EventDetailPage
        data={{
          kind: "event",
          event: projection("lead", {
            status: "approved",
            safetyStage: { state: "approved", current: true },
          }),
        }}
      />
    );

    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByText("Safety approved")).toBeNull();
  });

  it("titles a venue staff event with the requested venue", async () => {
    render(
      <EventDetailPage
        data={
          {
            kind: "event",
            event: projection("venue_staff", {
              venueRequests: [
                {
                  id: "vr-1",
                  status: "pending",
                  venueName: "Riverside Loft",
                  date: "2026-11-21",
                  startTime: "18:00",
                  endTime: "22:00",
                },
              ],
            }),
            venueDecisions: {
              requests: [
                {
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
                    accessibilityRequirements: "Step-free entrance",
                    requiredFacilities: "6 power drops, WiFi",
                  },
                },
              ],
              venues: [],
            },
          } as unknown as EventPageData
        }
      />
    );

    expect(screen.queryByText("venue staff access")).toBeNull();
    expect(screen.getByRole("heading", { name: "Riverside Loft" })).toBeTruthy();
    await screen.findByRole("heading", { name: /Booking request details/ });
    expect(screen.getByRole("heading", { name: "Record a decision" })).toBeTruthy();
  });

  it("renders the technical support header without a venue row", async () => {
    render(
      <EventDetailPage
        data={{
          kind: "event",
          event: projection("technical_support", { venue: undefined }),
        }}
      />
    );

    expect(screen.queryByText("technical support access")).toBeNull();
    expect(screen.getByRole("heading", { name: "ConnectSphere Open Day" })).toBeTruthy();
    await screen.findByRole("region", { name: "Equipment lines" });
    expect(screen.queryByText("Harbor Hall")).toBeNull();
  });

  it("falls back to Venue request when the event carries no requests", async () => {
    render(
      <EventDetailPage
        data={{
          kind: "event",
          event: projection("venue_staff", {
            venueRequests: [],
          }),
        }}
      />
    );

    expect(await screen.findByRole("heading", { name: "Venue request" })).toBeTruthy();
  });

  it("renders the lead's read-only triage detail from the coordination request", async () => {
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
              venueRequests: [],
            },
            coordinators: [],
          } as unknown as EventPageData
        }
      />
    );

    expect(await screen.findByText("unassigned request")).toBeTruthy();
    expect(screen.getByText("Submitted")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Unassigned open day" })).toBeTruthy();
  });

  it("shows the triage record and the Lead's assignment form in the main column, with no rail", async () => {
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
              equipmentRequirements: [],
              clarifications: [],
              cancellationRequests: [],
              changeRequests: [],
              outstandingReleases: null,
              venueRequests: [],
            },
            coordinators: [{ id: "coord-1", name: "Bailey", email: "b@example.com" }],
          } as unknown as EventPageData
        }
      />
    );

    await screen.findByRole("heading", { name: "Request details" });
    expect(screen.queryByRole("complementary", { name: "Actions" })).toBeNull();
    expect(container.querySelector("main #request")).toBeTruthy();
    // PTR-145: the Lead's assignment form is the queue detail's one action, and it sits in the
    // main column rather than on a rail.
    expect(container.querySelector("main #assignment")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assign coordinator" })).toBeTruthy();
  });
});
