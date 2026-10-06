import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RegistrationListPage } from "#/features/events/components/registration-list-page";
import type { AttendeeRegistrationProjection } from "#/features/events/access";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (href, [key, value]) => href.replace(`$${key}`, value),
        to
      )}
    >
      {children}
    </a>
  ),
}));

function cardFor(name: string) {
  const item = screen.getByRole("heading", { name }).closest("li");
  if (!item) throw new Error(`Could not find the registration card for ${name}`);
  return within(item);
}

function registration(
  id: number,
  overrides: Partial<AttendeeRegistrationProjection> = {}
): AttendeeRegistrationProjection {
  return {
    eventId: id,
    eventName: `Event ${id}`,
    eventStatus: "confirmed",
    registrationEnabled: true,
    registrationStatus: "registered",
    eventDate: "2030-01-01",
    endDate: "2030-01-01",
    startTime: "09:00",
    endTime: "17:00",
    venue: null,
    ...overrides,
  };
}

describe("RegistrationListPage", () => {
  it("shows current booking details and registration statuses, including cancelled events", () => {
    const active = registration(1, {
      venue: {
        name: "Current Hall",
        location: "Level 4",
        date: "2030-02-14",
        endDate: "2030-02-15",
        startTime: "10:00",
        endTime: "01:00",
      },
    });
    const cancelled = registration(2, {
      eventName: "Cancelled Event",
      eventStatus: "cancelled",
      registrationStatus: "withdrawn",
    });

    render(<RegistrationListPage registrations={[active, cancelled]} />);

    const activeCard = cardFor("Event 1");
    expect(activeCard.getByText("14 Feb 2030 – 15 Feb 2030")).toBeTruthy();
    expect(activeCard.getByText("10:00 – 01:00 (next day)")).toBeTruthy();
    expect(activeCard.getByText("Current Hall")).toBeTruthy();
    expect(activeCard.getByText("Level 4")).toBeTruthy();
    expect(activeCard.getByLabelText("Your registration: Registered")).toBeTruthy();

    const cancelledCard = cardFor("Cancelled Event");
    expect(cancelledCard.getByLabelText("Status: Cancelled")).toBeTruthy();
    expect(cancelledCard.getByLabelText("Your registration: Withdrawn")).toBeTruthy();
    expect(cancelledCard.getByText("Withdrawn")).toBeTruthy();
    expect(cancelledCard.queryByRole("link", { name: "Cancelled Event" })).toBeNull();
  });

  it("uses proposal details and confirmation fallbacks when there is no booking", () => {
    render(
      <RegistrationListPage
        registrations={[
          registration(3),
          registration(4, {
            eventName: "Unscheduled event",
            eventDate: null,
            endDate: null,
            startTime: null,
            endTime: null,
          }),
        ]}
      />
    );

    const proposed = cardFor("Event 3");
    expect(proposed.getByText("1 Jan 2030")).toBeTruthy();
    expect(proposed.getByText("09:00–17:00")).toBeTruthy();
    expect(proposed.getByText("Venue to be confirmed")).toBeTruthy();
    expect(proposed.getByRole("link", { name: "Event 3" }).getAttribute("href")).toBe("/events/3");

    const unscheduled = cardFor("Unscheduled event");
    expect(unscheduled.getByText("Date to be confirmed")).toBeTruthy();
    expect(unscheduled.getByText("Time to be confirmed")).toBeTruthy();
  });

  it("uses date and time confirmation fallbacks when proposal values are partial", () => {
    render(
      <RegistrationListPage
        registrations={[
          registration(5, {
            eventDate: "2030-01-01",
            startTime: null,
            endTime: null,
          }),
        ]}
      />
    );

    const partial = cardFor("Event 5");
    expect(partial.getByText("1 Jan 2030")).toBeTruthy();
    expect(partial.getByText("Time to be confirmed")).toBeTruthy();
  });

  it("shows an empty state when the attendee has no registrations", () => {
    render(<RegistrationListPage registrations={[]} />);

    expect(screen.getByText("You have no event registrations yet.")).toBeTruthy();
  });
});
