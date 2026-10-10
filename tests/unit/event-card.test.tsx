import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventCard, eventTitle } from "#/features/events/components/event-card";
import type { EventAccess, EventProjection } from "#/features/events/access";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    return <a href={href}>{children}</a>;
  },
}));

function projection(access: EventAccess, event: EventProjection["event"]): EventProjection {
  return { access, event };
}

const timed = {
  id: 7,
  name: "ConnectSphere Open Day",
  description: "An open day for new members.",
  eventDate: "2026-11-04",
  startTime: "10:00",
  endTime: "16:00",
  status: "confirmed",
  registrationEnabled: true,
} as const;

describe("EventCard", () => {
  it("titles a venue staff card with the venue name, falling back to Venue request", () => {
    const { rerender } = render(
      <EventCard
        event={projection("venue_staff", {
          id: 7,
          eventDate: "2026-10-01",
          startTime: "09:00",
          endTime: "17:00",
          status: "submitted",
          venueRequest: { id: "vr-1", status: "pending", venueName: "Harbor Hall" },
        })}
      />
    );

    expect(screen.getByText("venue staff access")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Harbor Hall" })).toBeTruthy();

    rerender(
      <EventCard
        event={projection("venue_staff", {
          id: 7,
          eventDate: "2026-10-01",
          startTime: "09:00",
          endTime: "17:00",
          status: "submitted",
          venueRequest: { id: "vr-1", status: "pending" },
        })}
      />
    );

    expect(screen.getByRole("heading", { name: "Venue request" })).toBeTruthy();
  });

  it("always links a staff card title to the event page", () => {
    render(
      <EventCard
        event={projection("coordinator", {
          ...timed,
          status: "submitted",
        })}
      />
    );

    expect(screen.getByRole("link", { name: "ConnectSphere Open Day" }).getAttribute("href")).toBe(
      "/events/7"
    );
  });

  it("titles an untitled event without a venue request", () => {
    expect(
      eventTitle(
        projection("organiser", {
          id: 7,
          eventDate: null,
          startTime: null,
          endTime: null,
          status: "draft",
        })
      )
    ).toBe("Untitled event");
    expect(
      eventTitle(
        projection("venue_staff", {
          id: 7,
          eventDate: null,
          startTime: null,
          endTime: null,
          status: "submitted",
          venueRequest: { id: "vr-1", status: "pending" },
        })
      )
    ).toBe("Venue request");
  });

  it("links an attendee card only when the event has an attendee page", () => {
    const { unmount } = render(<EventCard event={projection("attendee", { ...timed })} />);
    expect(screen.getByRole("link", { name: "ConnectSphere Open Day" }).getAttribute("href")).toBe(
      "/events/7"
    );
    unmount();

    render(
      <EventCard
        event={projection("attendee", {
          ...timed,
          status: "under_review",
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })}
      />
    );

    expect(screen.getByRole("heading", { name: "ConnectSphere Open Day" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "ConnectSphere Open Day" })).toBeNull();
  });

  it("explains an unlinked attendee card that has not ended", () => {
    render(
      <EventCard
        event={projection("attendee", {
          ...timed,
          status: "under_review",
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })}
      />
    );

    expect(screen.queryByRole("link", { name: "ConnectSphere Open Day" })).toBeNull();
    expect(screen.getByText("The event page opens once this event is confirmed.")).toBeTruthy();
  });

  it("marks a completed attendee card as ended, without a link", () => {
    render(
      <EventCard
        event={projection("attendee", {
          ...timed,
          status: "completed",
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })}
      />
    );

    expect(screen.queryByRole("link", { name: "ConnectSphere Open Day" })).toBeNull();
    expect(screen.getByText("This event has ended.")).toBeTruthy();
  });

  it("shows the Registered badge only for a registered attendee", () => {
    const { unmount } = render(
      <EventCard
        event={projection("attendee", {
          ...timed,
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })}
      />
    );
    expect(screen.getByText("Registered")).toBeTruthy();
    unmount();

    render(<EventCard event={projection("attendee", { ...timed, registration: null })} />);
    expect(screen.queryByText("Registered")).toBeNull();
  });

  it("renders the description, date and time, and omits each when absent", () => {
    const { unmount } = render(<EventCard event={projection("organiser", { ...timed })} />);

    expect(screen.getByText("An open day for new members.")).toBeTruthy();
    expect(screen.getByText("4 Nov 2026")).toBeTruthy();
    expect(screen.getByText("10:00–16:00")).toBeTruthy();
    unmount();

    render(
      <EventCard
        event={projection("organiser", {
          id: 7,
          name: "Untimed gathering",
          eventDate: null,
          startTime: null,
          endTime: null,
          status: "draft",
        })}
      />
    );

    expect(screen.queryByText("An open day for new members.")).toBeNull();
    expect(screen.queryByText("4 Nov 2026")).toBeNull();
    expect(screen.queryByText("10:00–16:00")).toBeNull();
  });
});
