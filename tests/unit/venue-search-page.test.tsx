// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import {
  VenueListPage,
  appliedFilters,
  requestSearch,
  summariseUnsuitable,
} from "#/features/venues/components/venue-list-page";
import { DEFAULT_OPERATING_HOURS, INITIAL_ROOM_LAYOUTS } from "#/features/venues/schema";
import type { VenueSearchResult } from "#/features/venues/server-fns";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(options: unknown) => void>() }));

vi.mock("@tanstack/react-router", () => ({
  // Keep the link's search on the element, so a test can read what the link carries.
  Link: ({ children, to, search }: { children: React.ReactNode; to: string; search?: object }) => (
    <a href={to} data-search={search === undefined ? undefined : JSON.stringify(search)}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

/** The search that a rendered link carries, or `undefined` for none. */
function linkSearch(link: HTMLElement): unknown {
  const search = link.dataset.search;
  return search === undefined ? undefined : JSON.parse(search);
}

const user: SessionUser = {
  id: "coordinator",
  name: "Casey",
  email: "casey@example.com",
  role: "event_coordinator",
};

const matchingVenue = {
  id: 7,
  name: "Great Hall",
  location: "East Wing",
  maxCapacity: 200,
  setupMinutes: 0,
  turnaroundMinutes: 0,
  facilities: ["Projector", "PA system"],
  accessibilityFeatures: ["Step-free access"],
  supportedLayouts: ["theatre" as const],
  operatingHours: DEFAULT_OPERATING_HOURS,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

function result(overrides: Partial<VenueSearchResult> = {}): VenueSearchResult {
  return {
    event: null,
    filters: {},
    venues: [matchingVenue],
    unsuitable: [],
    layouts: [...INITIAL_ROOM_LAYOUTS],
    ...overrides,
  };
}

const FILTERS = [
  "Date (optional)",
  "End date (optional)",
  "Start time (optional)",
  "End time (optional)",
  "Expected attendance (optional)",
  "Location (optional)",
  "Minimum capacity (optional)",
  "Accessibility features (optional)",
  "Supported layout (optional)",
  "Required facilities (optional)",
];

/** Type into the controlled input, then read its value. */
async function fill(actor: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = screen.getByLabelText<HTMLInputElement>(label, { exact: true });
  await actor.clear(input);
  await actor.type(input, value);
}

function fieldValue(label: string) {
  return screen.getByLabelText<HTMLInputElement>(label, { exact: true }).value;
}

beforeEach(() => {
  navigate.mockClear();
});

describe("VenueListPage search", () => {
  it("offers every PTR-29 filter and shows the result's key facilities", () => {
    render(<VenueListPage user={user} result={result()} />);

    for (const label of FILTERS) {
      expect(screen.getByLabelText(label, { exact: true })).toBeTruthy();
    }

    const results = screen.getByRole("region", { name: "Venue results" });
    expect(within(results).getAllByRole("link", { name: "Great Hall" })).toHaveLength(2);
    expect(within(results).getAllByText("East Wing")).toHaveLength(2);
    // The card names its values; the table shows bare values.
    expect(within(results).getByText("Capacity 200")).toBeTruthy();
    expect(within(results).getByText("200")).toBeTruthy();
    expect(within(results).getByText("Facilities:")).toBeTruthy();
    expect(within(results).getAllByText("Projector, PA system")).toHaveLength(2);
    expect(within(results).getByText("Layouts:")).toBeTruthy();
    expect(within(results).getAllByText("Theatre")).toHaveLength(2);
    // The catalogue table lets long values wrap instead of overprinting the next column.
    for (const cell of [
      screen.getByTitle("Projector, PA system", { exact: true }),
      screen.getByTitle("Theatre", { exact: true }),
    ]) {
      expect(cell.className).toContain("whitespace-normal");
    }
  });

  it("groups the fields under When, Who and where, and Room requirements", () => {
    render(<VenueListPage user={user} result={result()} />);

    expect(screen.getByText("When")).toBeTruthy();
    expect(screen.getByText("Who and where")).toBeTruthy();
    expect(screen.getByText("Room requirements")).toBeTruthy();
    expect(screen.getByText("The time window repeats each day in the date range.")).toBeTruthy();
  });

  it("opens prefilled from an event's requirements", () => {
    render(
      <VenueListPage
        user={user}
        result={result({
          event: { id: 41, name: "Annual summit" },
          filters: {
            eventId: 41,
            date: "2026-10-05",
            endDate: "2026-10-06",
            startTime: "10:00",
            endTime: "12:00",
            expectedAttendance: 120,
            accessibility: "Step-free access",
            layout: "Theatre seating",
            facilities: "Projector, PA system",
          },
        })}
      />
    );

    expect(screen.getByText("Prefilled from Annual summit")).toBeTruthy();
    expect(fieldValue("Date (optional)")).toBe("2026-10-05");
    expect(fieldValue("End date (optional)")).toBe("2026-10-06");
    expect(fieldValue("Expected attendance (optional)")).toBe("120");
    expect(fieldValue("Supported layout (optional)")).toBe("Theatre seating");
    expect(fieldValue("Required facilities (optional)")).toBe("Projector, PA system");
  });

  it("follows a new filters prop into the form values", () => {
    const { rerender } = render(<VenueListPage user={user} result={result()} />);
    expect(fieldValue("Location (optional)")).toBe("");

    rerender(
      <VenueListPage
        user={user}
        result={result({ filters: { location: "East Wing", capacity: 150 } })}
      />
    );

    expect(fieldValue("Location (optional)")).toBe("East Wing");
    expect(fieldValue("Minimum capacity (optional)")).toBe("150");
  });

  it("shows an explicit empty result without an error", () => {
    render(
      <VenueListPage
        user={user}
        result={result({ filters: { location: "Nowhere" }, venues: [] })}
      />
    );

    expect(screen.getByText("No venues match these requirements.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains an empty window that crosses midnight instead of the generic copy", () => {
    render(
      <VenueListPage
        user={user}
        result={result({
          filters: { date: "2026-10-05", startTime: "22:00", endTime: "02:00" },
          venues: [],
        })}
      />
    );

    expect(screen.getByText("A search window cannot cross midnight.")).toBeTruthy();
    expect(
      screen.getByText(
        "Venue opening hours end on the same day. Choose an end time later than the start time."
      )
    ).toBeTruthy();
    expect(screen.queryByText("No venues match these requirements.")).toBeNull();
  });

  it("applies the form through route search parameters", async () => {
    const actor = userEvent.setup();
    render(
      <VenueListPage
        user={user}
        result={result({ event: { id: 41, name: "Annual summit" }, filters: { eventId: 41 } })}
      />
    );

    await fill(actor, "Date (optional)", "2026-10-05");
    await fill(actor, "Start time (optional)", "10:00");
    await fill(actor, "End time (optional)", "12:00");
    await fill(actor, "Expected attendance (optional)", "120");
    await actor.click(screen.getByRole("button", { name: "Search venues" }));

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        to: "/venues",
        search: {
          eventId: 41,
          date: "2026-10-05",
          startTime: "10:00",
          endTime: "12:00",
          expectedAttendance: 120,
        },
      });
    });
    // A successful search moves focus to the results heading, which scrolls the changed
    // results into view and announces them.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Venue results" }));
  });

  it("disables Clear filters when no filter is applied, and enables it once one is", async () => {
    const actor = userEvent.setup();
    const { rerender } = render(<VenueListPage user={user} result={result()} />);
    expect(screen.getByRole("button", { name: "Clear filters" })).toHaveProperty("disabled", true);

    rerender(<VenueListPage user={user} result={result({ filters: { location: "East" } })} />);
    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear).toHaveProperty("disabled", false);

    await fill(actor, "Start time (optional)", "10:00");
    await actor.click(screen.getByRole("button", { name: "Search venues" }));

    expect(screen.getByRole("alert").textContent).toBe("Choose both a start and end time");
    expect(navigate).not.toHaveBeenCalled();

    await actor.click(clear);

    expect(fieldValue("Start time (optional)")).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: "/venues", search: {} });
  });

  it("summarises the applied filters above the results with a clear-all action", async () => {
    const actor = userEvent.setup();
    render(
      <VenueListPage
        user={user}
        result={result({
          filters: { date: "2026-10-05", endDate: "2026-10-06", capacity: 150 },
        })}
      />
    );

    const applied = screen.getByRole("region", { name: "Applied filters" });
    expect(within(applied).getByText("Dates: 2026-10-05 to 2026-10-06")).toBeTruthy();
    expect(within(applied).getByText("Minimum capacity: 150")).toBeTruthy();

    await actor.click(within(applied).getByRole("button", { name: "Clear all" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/venues", search: {} });
  });

  it("shows no applied-filter summary on an unfiltered page", () => {
    render(<VenueListPage user={user} result={result()} />);
    expect(screen.queryByRole("region", { name: "Applied filters" })).toBeNull();
  });
});

describe("appliedFilters", () => {
  it("lists each set filter and skips the event context", () => {
    expect(
      appliedFilters({
        eventId: 41,
        date: "2026-10-05",
        startTime: "10:00",
        endTime: "12:00",
        expectedAttendance: 120,
        capacity: 150,
        location: "East Wing",
        accessibility: "Step-free access",
        layout: "Theatre seating",
        facilities: "Projector, PA system",
      })
    ).toEqual([
      { key: "dates", label: "Dates", value: "2026-10-05" },
      { key: "time", label: "Time", value: "10:00–12:00" },
      { key: "expectedAttendance", label: "Expected attendance", value: "120" },
      { key: "capacity", label: "Minimum capacity", value: "150" },
      { key: "location", label: "Location", value: "East Wing" },
      { key: "accessibility", label: "Accessibility", value: "Step-free access" },
      { key: "layout", label: "Layout", value: "Theatre seating" },
      { key: "facilities", label: "Facilities", value: "Projector, PA system" },
    ]);
  });

  it("combines a date range and returns nothing when unfiltered", () => {
    expect(appliedFilters({ date: "2026-10-05", endDate: "2026-10-07" })).toEqual([
      { key: "dates", label: "Dates", value: "2026-10-05 to 2026-10-07" },
    ]);
    expect(appliedFilters({})).toEqual([]);
    expect(appliedFilters({ eventId: 41 })).toEqual([]);
  });
});

describe("summariseUnsuitable", () => {
  it("counts the venues that fell short and each failed criterion", () => {
    expect(
      summariseUnsuitable([
        {
          failures: [{ criterion: "capacity" }, { criterion: "facilities" }],
        },
        { failures: [{ criterion: "capacity" }] },
      ])
    ).toBe("2 venues fell short: 2 too small, 1 missing facilities");
  });

  it("names the searched layout and uses the singular", () => {
    expect(summariseUnsuitable([{ failures: [{ criterion: "layout" }] }], "Theatre seating")).toBe(
      "1 venue fell short: 1 do not offer Theatre seating"
    );
  });

  it("counts each venue once per criterion", () => {
    expect(
      summariseUnsuitable([
        {
          failures: [{ criterion: "booking" }, { criterion: "booking" }],
        },
      ])
    ).toBe("1 venue fell short: 1 already booked");
  });
});

describe("VenueListPage suitability (PTR-30)", () => {
  const smallRoom = {
    ...matchingVenue,
    id: 8,
    name: "Small Room",
    maxCapacity: 40,
    setupMinutes: 0,
    turnaroundMinutes: 0,
    facilities: ["Whiteboard"],
  };

  it("names why each unsuitable venue fell short once something was asked (AC5)", () => {
    render(
      <VenueListPage
        user={user}
        result={result({
          filters: { expectedAttendance: 120, facilities: "Projector" },
          unsuitable: [
            {
              venue: smallRoom,
              failures: [
                { criterion: "capacity", message: "Holds 40; 120 needed" },
                { criterion: "facilities", message: "Missing facilities: projector" },
              ],
            },
          ],
        })}
      />
    );

    const results = screen.getByRole("region", { name: "Venue results" });
    expect(within(results).getByText("1 venue suitable, 1 not suitable")).toBeTruthy();
    // Show suitable venues as results. List shortfalls in a separate region below them.
    expect(within(results).queryByRole("link", { name: "Small Room" })).toBeNull();
    const unsuitable = screen.getByRole("region", { name: "Not suitable" });
    expect(
      within(unsuitable).getByText("1 venue fell short: 1 too small, 1 missing facilities")
    ).toBeTruthy();
    expect(within(unsuitable).getByRole("link", { name: "Small Room" })).toBeTruthy();
    expect(within(unsuitable).getByText(/Holds 40; 120 needed/)).toBeTruthy();
    expect(within(unsuitable).getByText(/Missing facilities: projector/)).toBeTruthy();
    // AC6 specifies where to show the verdict.
    expect(within(unsuitable).getByText(/books or blocks nothing/)).toBeTruthy();
  });

  it("keeps the catalogue plain when nothing has been asked of it", () => {
    render(
      <VenueListPage
        user={user}
        result={result({ unsuitable: [{ venue: smallRoom, failures: [] }] })}
      />
    );

    expect(screen.queryByRole("region", { name: "Not suitable" })).toBeNull();
    expect(screen.getByText("1 venue")).toBeTruthy();
  });

  it("does not list the venues as failing a window that crosses midnight", () => {
    render(
      <VenueListPage
        user={user}
        result={result({
          filters: { date: "2026-10-05", startTime: "22:00", endTime: "02:00" },
          venues: [],
          unsuitable: [
            {
              venue: smallRoom,
              failures: [
                { criterion: "availability", message: "The requested window crosses midnight" },
              ],
            },
          ],
        })}
      />
    );

    expect(screen.getByText("A search window cannot cross midnight.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Not suitable" })).toBeNull();
  });

  it("shows the reasons beneath an explicit empty result", () => {
    render(
      <VenueListPage
        user={user}
        result={result({
          filters: { expectedAttendance: 500 },
          venues: [],
          unsuitable: [
            {
              venue: smallRoom,
              failures: [{ criterion: "capacity", message: "Holds 40; 500 needed" }],
            },
          ],
        })}
      />
    );

    expect(screen.getByText("No venue meets every requirement.")).toBeTruthy();
    expect(screen.getByText(/Holds 40; 500 needed/)).toBeTruthy();
  });
});

/**
 * PTR-138 AC1: a suitable venue's link carries the event and the search's session into the
 * request form. An unsuitable venue's link carries nothing, so its page offers no request.
 */
describe("VenueListPage request links (PTR-138 AC1)", () => {
  const sessionFilters = {
    eventId: 41,
    date: "2026-10-12",
    startTime: "14:00",
    endTime: "16:00",
    expectedAttendance: 30,
    location: "East Wing",
    capacity: 20,
    layout: "Boardroom",
    accessibility: "Step-free access",
    facilities: "Projector",
  };

  it("carries the date, the times, and the set session requirements of a one-day search", () => {
    expect(requestSearch(41, sessionFilters)).toEqual({
      eventId: 41,
      date: "2026-10-12",
      startTime: "14:00",
      endTime: "16:00",
      expectedAttendance: 30,
      layout: "Boardroom",
      accessibilityRequirements: "Step-free access",
      requiredFacilities: "Projector",
    });
    // The same end date still makes one day.
    expect(requestSearch(41, { ...sessionFilters, endDate: "2026-10-12" })).toMatchObject({
      startTime: "14:00",
      endTime: "16:00",
    });
  });

  it("carries only the first date of a multi-day search, and leaves out unset requirements", () => {
    expect(
      requestSearch(41, {
        date: "2026-10-12",
        endDate: "2026-10-14",
        startTime: "14:00",
        endTime: "16:00",
        layout: "",
      })
    ).toEqual({ eventId: 41, date: "2026-10-12" });
    expect(requestSearch(41, {})).toEqual({ eventId: 41 });
  });

  it("gives suitable venues the request search and unsuitable venues none", () => {
    render(
      <VenueListPage
        user={user}
        result={result({
          event: { id: 41, name: "Annual summit" },
          filters: sessionFilters,
          unsuitable: [
            {
              venue: { ...matchingVenue, id: 8, name: "Small Room", maxCapacity: 20 },
              failures: [{ criterion: "capacity", message: "Holds 20; 30 needed" }],
            },
          ],
        })}
      />
    );

    const results = screen.getByRole("region", { name: "Venue results" });
    const suitableLinks = within(results).getAllByRole("link", { name: "Great Hall" });
    expect(suitableLinks).toHaveLength(2);
    for (const link of suitableLinks) {
      expect(linkSearch(link)).toEqual(requestSearch(41, sessionFilters));
    }
    const unsuitable = screen.getByRole("region", { name: "Not suitable" });
    expect(linkSearch(within(unsuitable).getByRole("link", { name: "Small Room" }))).toBe(
      undefined
    );
  });
});
