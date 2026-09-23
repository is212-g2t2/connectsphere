import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "#/features/auth/session";
import { VenueListPage } from "#/features/venues/components/venue-list-page";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { VenueSearchResult } from "#/features/venues/server-fns";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn<(options: unknown) => void>() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigate,
}));

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
    ...overrides,
  };
}

const FILTERS = [
  "Date",
  "End date",
  "Start time",
  "End time",
  "Expected attendance",
  "Location",
  "Minimum capacity",
  "Accessibility features",
  "Supported layout",
  "Required facilities",
];

/** Types into the controlled input the way a person does, then reads back what it holds. */
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
    expect(within(results).getByRole("link", { name: "Great Hall" })).toBeTruthy();
    expect(within(results).getByText("East Wing")).toBeTruthy();
    expect(within(results).getByText("200")).toBeTruthy();
    expect(within(results).getByText("Projector, PA system")).toBeTruthy();
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
    expect(fieldValue("Date")).toBe("2026-10-05");
    expect(fieldValue("End date")).toBe("2026-10-06");
    expect(fieldValue("Expected attendance")).toBe("120");
    expect(fieldValue("Supported layout")).toBe("Theatre seating");
    expect(fieldValue("Required facilities")).toBe("Projector, PA system");
  });

  it("follows a new filters prop into the form values", () => {
    const { rerender } = render(<VenueListPage user={user} result={result()} />);
    expect(fieldValue("Location")).toBe("");

    rerender(
      <VenueListPage
        user={user}
        result={result({ filters: { location: "East Wing", capacity: 150 } })}
      />
    );

    expect(fieldValue("Location")).toBe("East Wing");
    expect(fieldValue("Minimum capacity")).toBe("150");
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

    await fill(actor, "Date", "2026-10-05");
    await fill(actor, "Start time", "10:00");
    await fill(actor, "End time", "12:00");
    await fill(actor, "Expected attendance", "120");
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
  });

  it("clears unsaved fields and a local validation error on an unfiltered page", async () => {
    const actor = userEvent.setup();
    render(<VenueListPage user={user} result={result()} />);

    await fill(actor, "Start time", "10:00");
    await actor.click(screen.getByRole("button", { name: "Search venues" }));

    expect(screen.getByRole("alert").textContent).toBe("Choose both a start and end time");
    expect(navigate).not.toHaveBeenCalled();

    await actor.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(fieldValue("Start time")).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: "/venues", search: {} });
  });
});

describe("VenueListPage suitability (PTR-30)", () => {
  const smallRoom = {
    ...matchingVenue,
    id: 8,
    name: "Small Room",
    maxCapacity: 40,
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
    // Results stay the suitable venues; the shortfalls are their own region beneath them.
    expect(within(results).queryByRole("link", { name: "Small Room" })).toBeNull();
    const unsuitable = screen.getByRole("region", { name: "Not suitable" });
    expect(within(unsuitable).getByRole("link", { name: "Small Room" })).toBeTruthy();
    expect(within(unsuitable).getByText("Holds 40; 120 needed")).toBeTruthy();
    expect(within(unsuitable).getByText("Missing facilities: projector")).toBeTruthy();
    // AC6 stated where the verdict is read.
    expect(within(unsuitable).getByText(/books or blocks nothing/)).toBeTruthy();
  });

  it("keeps the catalogue plain when nothing has been asked of it", () => {
    render(
      <VenueListPage
        user={user}
        result={result({ unsuitable: [{ venue: smallRoom, failures: [] }] })}
      />
    );

    expect(screen.queryByRole("heading", { name: "Not suitable" })).toBeNull();
    expect(screen.getByText("1 venue")).toBeTruthy();
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
    expect(screen.getByText("Holds 40; 500 needed")).toBeTruthy();
  });
});
