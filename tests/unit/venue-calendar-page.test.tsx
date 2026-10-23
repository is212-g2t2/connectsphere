// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VenueCalendarPage,
  MONTH_FOCUS_KEY,
} from "#/features/venues/components/venue-calendar-page";
import type { SessionUser } from "#/features/auth/session";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { Venue, VenueAvailability } from "#/features/venues/server-fns";

const { navigate, invalidate } = vi.hoisted(() => ({
  navigate: vi.fn<(options: unknown) => Promise<void>>().mockResolvedValue(undefined),
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
  requestedHolds: [],
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

/** Saturday to Sunday on default hours, which close at the weekend. */
const closedWeekendSchedule: VenueAvailability = {
  venue: { id: 7, name: "Great Hall" },
  startDate: "2026-10-10",
  endDate: "2026-10-11",
  available: [],
  occupied: [],
  requestedHolds: [],
};

/** Monday on default hours, which open on weekdays. */
const openMondaySchedule: VenueAvailability = {
  venue: { id: 7, name: "Great Hall" },
  startDate: "2026-10-12",
  endDate: "2026-10-12",
  available: [{ startsAt: "2026-10-12T08:00:00", endsAt: "2026-10-12T22:00:00" }],
  occupied: [],
  requestedHolds: [],
};

afterEach(() => {
  sessionStorage.removeItem(MONTH_FOCUS_KEY);
});

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
    // An occupied day names its state in text, not only a colour dot.
    expect(document.querySelector('[data-day="05/10/2026"]')?.textContent).toContain(
      "Unavailable / blocked"
    );
  });

  it("shows the legend including the mocked confirmed-booking state", () => {
    render(<VenueCalendarPage venues={[venue]} schedule={schedule} search={{}} />);

    const legend = within(screen.getByRole("list", { name: "Availability legend" }));
    // The grid draws no mark for free days, so the legend names none. Unmarked days read
    // as unmarked, not free.
    expect(legend.queryByText("Available")).toBeNull();
    expect(legend.getByText("Confirmed booking")).toBeTruthy();
    expect(legend.getByText("Unavailable / blocked")).toBeTruthy();
    // The fixture holds no tentative hold, buffer conflict or closed day, so the legend
    // names none of them. Unmarked days read as unmarked, not free.
    expect(legend.queryByText("Tentative hold")).toBeNull();
    expect(legend.queryByText("Buffer conflict")).toBeNull();
    expect(legend.queryByText("Closed — no operating hours")).toBeNull();
  });

  it("lays out the form, calendar and results in one two-column grid", () => {
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      />
    );

    const filters = screen.getByRole("region", { name: "Availability filters" });
    const calendars = screen.getAllByRole("region", { name: "Calendar for October 2026" });
    const results = screen.getByRole("region", { name: "Availability results" });
    // One calendar only: no duplicated component or state.
    expect(calendars).toHaveLength(1);
    const calendar = calendars[0];
    // Narrow screens read form, calendar, results in DOM order.
    expect(
      Boolean(filters.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    expect(
      Boolean(calendar.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    // Wide screens place the calendar beside the form and results in one grid.
    expect(calendar.parentElement?.className).toContain("split:grid-cols-[1.6fr_1fr]");
    expect(document.querySelector(".order-first")).toBeNull();
  });

  it("renders a closed row for every day with no operating hours", () => {
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={closedWeekendSchedule}
        search={{ venueId: 7, startDate: "2026-10-10", endDate: "2026-10-11" }}
      />
    );

    const results = screen.getByRole("region", { name: "Availability results" });
    expect(within(results).getAllByText("No operating hours · Great Hall")).toHaveLength(2);
    expect(within(results).getAllByText("Closed")).toHaveLength(4);

    const legend = within(screen.getByRole("list", { name: "Availability legend" }));
    expect(legend.getByText("Closed — no operating hours")).toBeTruthy();
    expect(legend.queryByText("Available")).toBeNull();

    expect(document.querySelector('[data-day="10/10/2026"]')?.className).toContain("line-through");
    expect(document.querySelector('[data-day="11/10/2026"]')?.className).toContain("line-through");
    expect(document.querySelector('[data-day="10/10/2026"]')?.className).not.toContain(
      "opacity-60"
    );
    // A closed day names its state in text, not only a struck style.
    expect(document.querySelector('[data-day="10/10/2026"]')?.textContent).toContain(
      "Closed — no operating hours"
    );
  });

  it("marks a buffer conflict apart from a block", () => {
    const conflicted: VenueAvailability = {
      venue: { id: 7, name: "Great Hall" },
      startDate: "2026-10-05",
      endDate: "2026-10-05",
      available: [],
      occupied: [
        {
          id: "1",
          state: "confirmed",
          label: "Confirmed booking",
          startsAt: "2026-10-05T10:00:00",
          endsAt: "2026-10-05T12:00:00",
          visibleStart: "2026-10-05T10:00:00",
          visibleEnd: "2026-10-05T12:00:00",
          bufferConflict: true,
        },
      ],
      requestedHolds: [],
    };
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={conflicted}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-05" }}
      />
    );

    const results = screen.getByRole("region", { name: "Availability results" });
    expect(within(results).getByText("Buffer conflict")).toBeTruthy();

    const legend = within(screen.getByRole("list", { name: "Availability legend" }));
    expect(legend.getByText("Buffer conflict")).toBeTruthy();

    expect(document.querySelector('[data-day="05/10/2026"]')?.className).toContain("ring-coral");
  });

  it("warns on a closed start day in the hold dialog", async () => {
    const user = userEvent.setup();
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={closedWeekendSchedule}
        search={{ venueId: 7, startDate: "2026-10-10", endDate: "2026-10-10" }}
        user={coordinatorUser}
        coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Request a hold…" }));

    expect(
      await screen.findByText("Great Hall is closed on 10 Oct 2026. Choose an open day.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send request" })).toHaveProperty("disabled", true);
  });

  it("refreshes hold defaults when the selected day changes", async () => {
    const user = userEvent.setup();
    const view = render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={closedWeekendSchedule}
        search={{ venueId: 7, startDate: "2026-10-10", endDate: "2026-10-10" }}
        user={coordinatorUser}
        coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Request a hold…" }));
    expect(await screen.findByText(/Hold window: 10 Oct 2026/)).toBeTruthy();

    view.rerender(
      <VenueCalendarPage
        venues={[venue]}
        schedule={openMondaySchedule}
        search={{ venueId: 7, startDate: "2026-10-12", endDate: "2026-10-12" }}
        user={coordinatorUser}
        coordinatorEvents={[{ id: 101, name: "Orientation Camp" }]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Request a hold…" }));
    expect(await screen.findByText(/Hold window: 12 Oct 2026/)).toBeTruthy();
  });

  it("queries the whole next month when the calendar advances", async () => {
    const user = userEvent.setup();
    navigate.mockClear();
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Go to the Next Month" }));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({
      to: "/venues/availability",
      search: { venueId: 7, startDate: "2026-11-01", endDate: "2026-11-30" },
    });
  });

  it("queries the whole previous month when the calendar goes back", async () => {
    const user = userEvent.setup();
    navigate.mockClear();
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Go to the Previous Month" }));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({
      to: "/venues/availability",
      search: { venueId: 7, startDate: "2026-09-01", endDate: "2026-09-30" },
    });
  });

  it("uses the leap-year last day when the next month is February", async () => {
    const user = userEvent.setup();
    navigate.mockClear();
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2028-01-10", endDate: "2028-01-20" }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Go to the Next Month" }));

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({
      to: "/venues/availability",
      search: { venueId: 7, startDate: "2028-02-01", endDate: "2028-02-29" },
    });
  });

  it("moves focus to the calendar for the new month after a month navigation", async () => {
    const user = userEvent.setup();
    const first = render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Go to the Next Month" }));
    expect(sessionStorage.getItem(MONTH_FOCUS_KEY)).toBe("2026-11-01");
    first.unmount();
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-11-01", endDate: "2026-11-30" }}
      />
    );

    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Calendar for November 2026" })
    );
    expect(sessionStorage.getItem(MONTH_FOCUS_KEY)).toBeNull();
  });

  it("does not move focus without a matching month focus intent", () => {
    const first = render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      />
    );
    expect(document.activeElement).toBe(document.body);
    first.unmount();

    sessionStorage.setItem(MONTH_FOCUS_KEY, "2026-12-01");
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      />
    );

    expect(document.activeElement).toBe(document.body);
    expect(sessionStorage.getItem(MONTH_FOCUS_KEY)).toBeNull();
  });

  it("still navigates when month focus storage is unavailable", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    navigate.mockClear();
    render(
      <VenueCalendarPage
        venues={[venue]}
        schedule={schedule}
        search={{ venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Go to the Next Month" }));

    expect(navigate).toHaveBeenCalledOnce();
    setItem.mockRestore();
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
    sessionStorage.setItem(MONTH_FOCUS_KEY, "2026-10-05");
    await user.click(screen.getByRole("button", { name: "Show availability" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/venues/availability",
      search: { venueId: 7, startDate: "2026-10-05", endDate: "2026-10-06" },
    });
    expect(sessionStorage.getItem(MONTH_FOCUS_KEY)).toBeNull();
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
});
