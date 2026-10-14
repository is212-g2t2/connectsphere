// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VenueCalendarPage } from "#/features/venues/components/venue-calendar-page";
import type { SessionUser } from "#/features/auth/session";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { Venue, VenueAvailability } from "#/features/venues/server-fns";

const { navigate, invalidate } = vi.hoisted(() => ({
  navigate: vi.fn<(options: unknown) => void>(),
  invalidate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate, navigate }),
}));

const venue: Venue = {
  id: 7,
  name: "Great Hall",
  location: "Level 2, East Wing",
  maxCapacity: 200,
  setupMinutes: 0,
  turnaroundMinutes: 0,
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

const staffUser: SessionUser = {
  id: "staff-1",
  name: "Staff User",
  email: "staff@example.com",
  role: "venue_staff",
};

const coordinatorUser: SessionUser = {
  id: "coord-1",
  name: "Coordinator User",
  email: "coord@example.com",
  role: "event_coordinator",
};

const scheduleWithOpenEndedBlock: VenueAvailability = {
  ...schedule,
  occupied: [
    {
      id: "1",
      state: "blocked",
      label: "Maintenance",
      startsAt: "2026-10-05T13:00:00",
      endsAt: "2026-10-06T18:00:00",
      visibleStart: "2026-10-05T13:00:00",
      visibleEnd: "2026-10-06T18:00:00",
      openEnded: true,
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
    // The fixture's row title and badge both say "Confirmed booking". A real booking hides its
    // event name and shows "another event" with the same badge (PTR-36).
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

  it("shows block controls to Venue Staff on a blocked row", () => {
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
        user={staffUser}
      />
    );

    const results = screen.getByRole("region", { name: "Availability results" });
    expect(within(results).getByRole("button", { name: "Block venue" })).toBeTruthy();
    expect(within(results).getByRole("button", { name: /Lift venue block/ })).toBeTruthy();
  });

  it("hides block controls from a Coordinator", () => {
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
        user={coordinatorUser}
        coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
      />
    );

    const results = screen.getByRole("region", { name: "Availability results" });
    expect(within(results).queryByRole("button", { name: "Block venue" })).toBeNull();
    expect(within(results).queryByRole("button", { name: /Lift venue block/ })).toBeNull();
  });

  it("renders an open-ended blocked period as until lifted", () => {
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={scheduleWithOpenEndedBlock}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      />
    );

    const results = screen.getByRole("region", { name: "Availability results" });
    expect(within(results).getByText("13:00 – until lifted · Great Hall")).toBeTruthy();
  });

  it("names the block's true period in the lift confirmation, not the visible slice", async () => {
    const user = userEvent.setup();
    const extended: VenueAvailability = {
      ...schedule,
      occupied: [
        {
          id: "1",
          state: "blocked",
          label: "Maintenance",
          startsAt: "2026-10-05T13:00:00",
          endsAt: "2026-10-10T15:00:00",
          visibleStart: "2026-10-05T13:00:00",
          visibleEnd: "2026-10-06T18:00:00",
        },
      ],
    };
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={extended}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
        user={staffUser}
      />
    );

    const results = screen.getByRole("region", { name: "Availability results" });
    expect(within(results).getByText("13:00 – 6 Oct 18:00 · Great Hall")).toBeTruthy();

    await user.click(within(results).getByRole("button", { name: /Lift venue block/ }));
    expect(await screen.findByText(/5 Oct 2026, 13:00 – 10 Oct 2026, 15:00/)).toBeTruthy();
    expect(screen.getByText(/unless a new arrangement now overlaps it/)).toBeTruthy();
  });

  it("opens the record dialog with an empty end for an open-ended block", async () => {
    const user = userEvent.setup();
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
        user={staffUser}
      />
    );

    const results = screen.getByRole("region", { name: "Availability results" });
    await user.click(within(results).getByRole("button", { name: "Block venue" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText<HTMLInputElement>("End date (optional)").value).toBe("");
    expect(within(dialog).getByText(/suspended until you lift the block/)).toBeTruthy();
  });
});
