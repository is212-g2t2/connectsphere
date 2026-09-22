import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VenueCalendarPage } from "#/features/venues/components/venue-calendar-page";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { Venue, VenueAvailability } from "#/features/venues/server-fns";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(options: unknown) => void>() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigate,
}));

const venue: Venue = {
  id: 7,
  name: "Great Hall",
  location: "Level 2, East Wing",
  maxCapacity: 200,
  facilities: [],
  accessibilityFeatures: [],
  supportedLayouts: [],
  operatingHours: DEFAULT_OPERATING_HOURS,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

const schedule: VenueAvailability = {
  venue: { id: 7, name: "Great Hall" },
  startDate: "2026-10-05",
  endDate: "2026-10-06",
  available: [{ startsAt: "2026-10-05T08:00:00", endsAt: "2026-10-05T13:00:00" }],
  occupied: [
    {
      id: "1",
      state: "blocked",
      label: "Maintenance",
      startsAt: "2026-10-05T13:00:00",
      endsAt: "2026-10-05T15:00:00",
      visibleStart: "2026-10-05T13:00:00",
      visibleEnd: "2026-10-05T15:00:00",
    },
    {
      id: "2",
      state: "confirmed",
      label: "Confirmed booking",
      startsAt: "2026-10-06T10:00:00",
      endsAt: "2026-10-06T12:00:00",
      visibleStart: "2026-10-06T10:00:00",
      visibleEnd: "2026-10-06T12:00:00",
    },
  ],
};

describe("VenueCalendarPage", () => {
  it("prompts for a venue and both dates before a schedule is applied", () => {
    render(<VenueCalendarPage venues={[venue]} schedule={null} search={{}} />);

    expect(screen.getByRole("heading", { name: "Venue calendar" })).toBeTruthy();
    expect(screen.getByText("Choose a venue and both dates to see its availability.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Availability results" })).toBeNull();
  });

  it("renders each period with its reason, time and state", () => {
    render(<VenueCalendarPage venues={[venue]} schedule={schedule} search={{}} />);

    const results = screen.getByRole("region", { name: "Availability results" });
    expect(within(results).getByRole("heading", { name: "Great Hall" })).toBeTruthy();
    expect(within(results).getByText("Times shown in venue local time")).toBeTruthy();
    expect(within(results).getByText("Maintenance")).toBeTruthy();
    expect(within(results).getByText("13:00 – 15:00 · Great Hall")).toBeTruthy();
    expect(within(results).getByText("Unavailable / blocked")).toBeTruthy();
    // The mocked booking's label and state both read "Confirmed booking" until a real booking
    // carries the event's name (PTR-31/PTR-33): the row title and its badge.
    expect(within(results).getAllByText("Confirmed booking")).toHaveLength(2);
    expect(within(results).getByText("10:00 – 12:00 · Great Hall")).toBeTruthy();
    expect(within(results).getByText("Available")).toBeTruthy();
  });

  it("shows the legend including the mocked confirmed-booking state", () => {
    render(<VenueCalendarPage venues={[venue]} schedule={schedule} search={{}} />);

    const legend = within(screen.getByRole("list", { name: "Availability legend" }));
    expect(legend.getByText("Available")).toBeTruthy();
    expect(legend.getByText("Confirmed booking")).toBeTruthy();
    expect(legend.getByText("Unavailable / blocked")).toBeTruthy();
  });

  it("refuses to navigate while the selection is incomplete", async () => {
    const user = userEvent.setup();
    render(<VenueCalendarPage venues={[venue]} schedule={null} search={{}} />);

    await user.click(screen.getByRole("button", { name: "Show availability" }));

    const alerts = screen.getAllByRole("alert");
    expect(alerts[0].textContent).toBe("Choose a venue");
    expect(screen.getByText("Choose a start date")).toBeTruthy();
    expect(screen.getByText("Choose an end date")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("applies a complete selection through the route search", async () => {
    const user = userEvent.setup();
    render(<VenueCalendarPage venues={[venue]} schedule={null} search={{}} />);

    await user.click(screen.getByLabelText("Venue"));
    await user.click(await screen.findByRole("option", { name: "Great Hall" }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-10-06" } });
    await user.click(screen.getByRole("button", { name: "Show availability" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/venues/availability",
      search: { venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
