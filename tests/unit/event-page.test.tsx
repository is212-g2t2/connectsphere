import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EventProjection } from "#/features/events/access";
import { EventPage } from "#/features/events/components/event-page";

/**
 * PTR-44: the attendee event view renders without a router, like the other page views
 * (`tests/unit/page-views.test.ts`). `Link` is the only router surface the page uses, so it is
 * mocked the same way — composed so a test can read where a link leads.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const projection: EventProjection = {
  access: "attendee",
  event: {
    id: 12,
    name: "ConnectSphere Open Day",
    description: "An open day for new members.",
    eventDate: "2026-12-05",
    endDate: "2026-12-05",
    startTime: "10:00",
    endTime: "15:00",
    status: "confirmed",
    registrationOpensAt: "2026-11-01T09:00",
    registrationClosesAt: "2026-12-01T17:00",
    registration: null,
    venue: {
      name: "Seminar Room 2A",
      location: "Level 2, ConnectSphere Marina Centre",
      date: "2026-12-05",
      endDate: "2026-12-05",
      startTime: "10:00",
      endTime: "15:00",
    },
  },
};

describe("EventPage (PTR-44)", () => {
  it("shows the published fields for an attendee projection (AC2)", () => {
    render(<EventPage event={projection} />);

    expect(screen.getByRole("heading", { name: "ConnectSphere Open Day" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "About Event" })).toBeTruthy();
    expect(screen.getByText("An open day for new members.")).toBeTruthy();
    expect(screen.getByText("DEC")).toBeTruthy();
    expect(screen.getByText(/5 December 2026/)).toBeTruthy();
    expect(screen.getByText("10:00–15:00")).toBeTruthy();
    expect(screen.getByText("Seminar Room 2A")).toBeTruthy();
    expect(screen.getByText("Level 2, ConnectSphere Marina Centre")).toBeTruthy();
    expect(screen.getByText("Registration")).toBeTruthy();
    expect(screen.getByText("Opens 1 Nov 2026, 09:00 – closes 1 Dec 2026, 17:00")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe(
      "/dashboard"
    );
  });

  it("shows the description under About Event and no Location section", () => {
    render(<EventPage event={projection} />);

    expect(screen.getByRole("region", { name: "About Event" })).toBeTruthy();
    expect(screen.getByText("An open day for new members.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Location" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Location" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in Maps" })).toBeNull();
  });

  it("hides About Event when the event carries no description", () => {
    render(
      <EventPage event={{ ...projection, event: { ...projection.event, description: "" } }} />
    );

    expect(screen.queryByRole("region", { name: "About Event" })).toBeNull();
  });

  it("shows a date range when the event runs over several days", () => {
    render(
      <EventPage
        event={{
          ...projection,
          event: { ...projection.event, venue: null, endDate: "2026-12-07" },
        }}
      />
    );

    expect(screen.getByText(/5 December 2026/)).toBeTruthy();
    expect(screen.getByText(/7 December 2026/)).toBeTruthy();
  });

  it("shows the published booking window when it differs from the proposal", () => {
    render(
      <EventPage
        event={{
          ...projection,
          event: {
            ...projection.event,
            venue: {
              name: "Seminar Room 2A",
              location: "Level 2, ConnectSphere Marina Centre",
              date: "2026-12-08",
              endDate: "2026-12-08",
              startTime: "11:00",
              endTime: "14:00",
            },
          },
        }}
      />
    );

    expect(screen.getByText(/8 December 2026/)).toBeTruthy();
    expect(screen.getByText("11:00–14:00")).toBeTruthy();
    expect(screen.queryByText(/5 December 2026/)).toBeNull();
  });

  it("shows a date range when the booking runs past midnight", () => {
    render(
      <EventPage
        event={{
          ...projection,
          event: {
            ...projection.event,
            venue: {
              name: "Seminar Room 2A",
              location: "Level 2, ConnectSphere Marina Centre",
              date: "2026-12-05",
              endDate: "2026-12-06",
              startTime: "22:00",
              endTime: "02:00",
            },
          },
        }}
      />
    );

    expect(screen.getByText(/5 December 2026/)).toBeTruthy();
    expect(screen.getByText(/6 December 2026/)).toBeTruthy();
    expect(screen.getByText("22:00 – 02:00 (next day)")).toBeTruthy();
  });

  it("shows a plain time for a multi-day booking that does not cross midnight into the next day", () => {
    render(
      <EventPage
        event={{
          ...projection,
          event: {
            ...projection.event,
            venue: {
              name: "Seminar Room 2A",
              location: "Level 2, ConnectSphere Marina Centre",
              date: "2026-12-05",
              endDate: "2026-12-07",
              startTime: "10:00",
              endTime: "15:00",
            },
          },
        }}
      />
    );

    expect(screen.getByText(/5 December 2026/)).toBeTruthy();
    expect(screen.getByText(/7 December 2026/)).toBeTruthy();
    expect(screen.getByText("10:00–15:00")).toBeTruthy();
    expect(screen.queryByText(/next day/)).toBeNull();
  });

  it("shows the registered state when the attendee holds a registration", () => {
    render(
      <EventPage
        event={{
          ...projection,
          event: {
            ...projection.event,
            registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
          },
        }}
      />
    );

    expect(screen.getByText("You're registered")).toBeTruthy();
    expect(screen.getByText("Opens 1 Nov 2026, 09:00 – closes 1 Dec 2026, 17:00")).toBeTruthy();
  });

  it("shows the period without the registered state once the registration no longer holds", () => {
    render(
      <EventPage
        event={{
          ...projection,
          event: {
            ...projection.event,
            registration: { status: "withdrawn", registeredAt: "2026-11-02T03:04:05.000Z" },
          },
        }}
      />
    );

    expect(screen.queryByText("You're registered")).toBeNull();
    expect(screen.getByText("Opens 1 Nov 2026, 09:00 – closes 1 Dec 2026, 17:00")).toBeTruthy();
  });

  it("says registration details are to be confirmed when the event carries no terms", () => {
    render(
      <EventPage
        event={{
          ...projection,
          event: {
            ...projection.event,
            registrationOpensAt: null,
            registrationClosesAt: null,
          },
        }}
      />
    );

    expect(screen.getByText("Registration details to be confirmed")).toBeTruthy();
  });

  it("shows a plain fallback when no venue is currently booked (AC3: no invented venue)", () => {
    render(<EventPage event={{ ...projection, event: { ...projection.event, venue: null } }} />);

    expect(screen.getByText("Venue to be confirmed")).toBeTruthy();
    expect(screen.queryByText("Seminar Room 2A")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open in Maps" })).toBeNull();
  });

  it("shows no booking decisions, equipment, or clarification threads (AC3)", () => {
    const { container } = render(<EventPage event={projection} />);

    // No confirmation record either: the status pill above is the only "Confirmed" on the page.
    expect(screen.getAllByText("Confirmed")).toHaveLength(1);
    expect(screen.queryByText("Expected attendance")).toBeNull();
    expect(screen.queryByText("Venue request")).toBeNull();
    expect(screen.queryByText("Equipment arrangements")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });
});
