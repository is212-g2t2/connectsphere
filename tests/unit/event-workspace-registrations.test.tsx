import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";

import type { EventProjection } from "#/features/events/access";
import { EventWorkspace } from "#/features/events/components/event-workspace";

const { listEventRegistrations } = vi.hoisted(() => ({
  listEventRegistrations: vi.fn<() => Promise<unknown[]>>(),
}));

vi.mock("#/features/events/server-fns", () => ({
  searchVipAttendees: vi.fn<() => Promise<unknown>>(),
  addVipRegistration: vi.fn<() => Promise<unknown>>(),
  removeVipRegistration: vi.fn<() => Promise<unknown>>(),
  confirmEvent: vi.fn<() => Promise<unknown>>(),
  listEventRegistrations,
}));
vi.mock("#/features/equipment-requests/server-fns", () => ({}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listEventRegistrations).mockResolvedValue([]);
});

function card(
  access: EventProjection["access"],
  places: NonNullable<EventProjection["event"]["places"]> = {
    registered: 5,
    vip: 1,
    limit: 39,
    capacity: 40,
  }
): EventProjection {
  return {
    access,
    event: {
      id: 12,
      name: "Gala",
      eventDate: "2030-01-01",
      startTime: "09:00",
      endTime: "17:00",
      status: "confirmed",
      places,
    },
  };
}

describe("workspace attendee registrations (PTR-48)", () => {
  it.each(["organiser", "coordinator"] as const)(
    "shows the capacity count and the attendee accordion to %s when ten or fewer",
    access => {
      render(<EventWorkspace events={[card(access)]} />);

      expect(screen.getByText("5 / 40 registered (+1 VIP)")).toBeTruthy();
      expect(screen.queryByText("5 / 39 registered (+1 VIP)")).toBeNull();
      expect(screen.getByRole("button", { name: "Attendees" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "View all attendees" })).toBeNull();
    }
  );

  it.each(["organiser", "coordinator"] as const)(
    "expands the accordion and fetches the list for %s",
    async access => {
      vi.mocked(listEventRegistrations).mockResolvedValueOnce([]);
      render(<EventWorkspace events={[card(access)]} />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Attendees" }));

      expect(listEventRegistrations).toHaveBeenCalledWith({ data: { id: 12 } });
      expect(await screen.findByText("No attendees registered.")).toBeTruthy();
    }
  );

  it.each(["organiser", "coordinator"] as const)(
    "links to the attendees page for %s when more than ten",
    access => {
      render(
        <EventWorkspace
          events={[card(access, { registered: 10, vip: 1, limit: 39, capacity: 40 })]}
        />
      );

      expect(screen.getByText("10 / 40 registered (+1 VIP)")).toBeTruthy();
      const link = screen.getByRole("link", { name: "View all attendees" });
      expect(link).toBeTruthy();
      expect(link.getAttribute("href")).toBe("/events/$eventId/attendees");
      expect(screen.queryByRole("button", { name: "Attendees" })).toBeNull();
    }
  );

  it.each(["organiser", "coordinator"] as const)(
    "shows the accordion at exactly ten total for %s",
    access => {
      render(
        <EventWorkspace
          events={[card(access, { registered: 9, vip: 1, limit: 39, capacity: 40 })]}
        />
      );

      expect(screen.getByText("9 / 40 registered (+1 VIP)")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Attendees" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "View all attendees" })).toBeNull();
    }
  );

  it("shows neither the count, the accordion nor the link to an attendee carrying places", () => {
    render(<EventWorkspace events={[card("attendee")]} />);

    expect(screen.queryByText("5 / 40 registered (+1 VIP)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Attendees" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View all attendees" })).toBeNull();
  });
});
