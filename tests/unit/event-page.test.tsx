import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EventProjection } from "#/features/events/access";
import { EventPage } from "#/features/events/components/event-page";

/**
 * PTR-44: the attendee event view renders without a router, like the other page views
 * (`tests/unit/page-views.test.ts`). `Link` and the register action's `useRouter` are the router
 * surfaces the page uses, so they are mocked the same way — composed so a test can read where a
 * link leads. `tests/unit/register-action.test.tsx` covers what the action does.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
}));
vi.mock("#/features/events/server-fns", () => ({
  registerForEvent: vi.fn<() => Promise<unknown>>(),
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
    registrationAvailability: { state: "open" },
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
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("offers the register action to an attendee who holds no registration (PTR-45)", () => {
    render(<EventPage event={projection} />);

    expect(screen.getByRole("button", { name: "Register" })).toBeTruthy();
  });

  it("shows the places taken against the place limit (PTR-45 AC10)", () => {
    render(
      <EventPage
        event={{
          ...projection,
          event: { ...projection.event, places: { registered: 36, limit: 40 } },
        }}
      />
    );

    expect(screen.getByText("36 / 40 registered")).toBeTruthy();
  });

  it("shows no count while the event has no confirmed venue to limit it", () => {
    render(
      <EventPage
        event={{ ...projection, event: { ...projection.event, venue: null, places: null } }}
      />
    );

    expect(screen.queryByText(/registered$/)).toBeNull();
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
    expect(screen.getByRole("button", { name: "Register" })).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
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

function renderWith(event: Partial<EventProjection["event"]>) {
  return render(<EventPage event={{ ...projection, event: { ...projection.event, ...event } }} />);
}

describe("EventPage registration availability (PTR-50)", () => {
  it("says registration is not yet open, shows the opening time once, and offers no action (AC1)", () => {
    renderWith({ registrationAvailability: { state: "not_yet_open" } });

    expect(screen.getByText("Registration is not yet open.")).toBeTruthy();
    expect(screen.getByText("Opens 1 Nov 2026, 09:00 – closes 1 Dec 2026, 17:00")).toBeTruthy();
    expect(screen.getAllByText(/1 Nov 2026, 09:00/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("says registration has closed and offers no action (AC2)", () => {
    renderWith({ registrationAvailability: { state: "closed" } });

    expect(screen.getByText("Registration has closed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("says the event is full in place of the count, and offers no action (AC3)", () => {
    renderWith({
      registrationAvailability: { state: "full", venueCapacity: null },
      places: { registered: 40, limit: 40 },
    });

    expect(screen.getByText("This event is full.")).toBeTruthy();
    expect(screen.queryByText("40 / 40 registered")).toBeNull();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("names the venue capacity when normal and VIP registrations fill the venue (AC3)", () => {
    // VIPs added after the normal places were taken leave more registrations than places.
    renderWith({
      registrationAvailability: { state: "full", venueCapacity: 30 },
      places: { registered: 2, limit: 1 },
    });

    expect(
      screen.getByText("This event is full. The venue capacity of 30 is reached.")
    ).toBeTruthy();
    expect(screen.queryByText("2 / 1 registered")).toBeNull();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("says the event is cancelled, shows no venue row, and offers no action (AC4)", () => {
    renderWith({
      status: "cancelled",
      registrationAvailability: { state: "cancelled" },
      venue: null,
    });

    expect(screen.getByText("This event is cancelled.")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText("Venue to be confirmed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("says a cancelled event is cancelled from its status alone, as the route decides (AC4)", () => {
    renderWith({ status: "cancelled", registrationAvailability: null });

    expect(screen.getByText("This event is cancelled.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });

  it("tells a registered Attendee of a cancelled event about their registration (AC4)", () => {
    renderWith({
      status: "cancelled",
      registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
      registrationAvailability: { state: "cancelled" },
    });

    expect(screen.getByText("This event is cancelled.")).toBeTruthy();
    expect(screen.getByText("You were registered for this event.")).toBeTruthy();
    expect(screen.queryByText("You're registered")).toBeNull();
  });

  it("offers no action while registration is unavailable for another reason", () => {
    renderWith({ registrationAvailability: { state: "unavailable" } });

    expect(screen.getByText("Registration is not open for this event.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Register" })).toBeNull();
  });
});
