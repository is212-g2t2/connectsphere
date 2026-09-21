import { fireEvent, render, screen, within } from "@testing-library/react";
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
    ...overrides,
  };
}

beforeEach(() => {
  navigate.mockClear();
});

describe("VenueListPage search", () => {
  it("offers every PTR-29 filter and shows the result's key facilities", () => {
    render(<VenueListPage user={user} result={result()} />);

    expect(screen.getByLabelText("Date")).toBeTruthy();
    expect(screen.getByLabelText("End date")).toBeTruthy();
    expect(screen.getByLabelText("Start time")).toBeTruthy();
    expect(screen.getByLabelText("End time")).toBeTruthy();
    expect(screen.getByLabelText("Expected attendance")).toBeTruthy();
    expect(screen.getByLabelText("Location")).toBeTruthy();
    expect(screen.getByLabelText("Minimum capacity")).toBeTruthy();
    expect(screen.getByLabelText("Accessibility features")).toBeTruthy();
    expect(screen.getByLabelText("Supported layout")).toBeTruthy();
    expect(screen.getByLabelText("Required facilities")).toBeTruthy();

    const results = screen.getByRole("region", { name: "Venue results" });
    expect(within(results).getByRole("link", { name: "Great Hall" })).toBeTruthy();
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
    expect(screen.getByLabelText("Date").getAttribute("value")).toBe("2026-10-05");
    expect(screen.getByLabelText("End date").getAttribute("value")).toBe("2026-10-06");
    expect(screen.getByLabelText("Expected attendance").getAttribute("value")).toBe("120");
    expect(screen.getByLabelText("Supported layout").getAttribute("value")).toBe("Theatre seating");
    expect(screen.getByLabelText("Required facilities").getAttribute("value")).toBe(
      "Projector, PA system"
    );
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

  it("applies the form through route search parameters", async () => {
    const actor = userEvent.setup();
    render(<VenueListPage user={user} result={result()} />);

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-05" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "12:00" } });
    fireEvent.change(screen.getByLabelText("Expected attendance"), {
      target: { value: "120" },
    });
    await actor.click(screen.getByRole("button", { name: "Search venues" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/venues",
      search: {
        date: "2026-10-05",
        startTime: "10:00",
        endTime: "12:00",
        expectedAttendance: 120,
      },
    });
  });

  it("clears unsaved fields and a local validation error on an unfiltered page", async () => {
    const actor = userEvent.setup();
    render(<VenueListPage user={user} result={result()} />);

    const startTime = screen.getByLabelText("Start time");
    await actor.type(startTime, "10:00");
    await actor.click(screen.getByRole("button", { name: "Search venues" }));
    expect(screen.getByRole("alert")).toBeTruthy();

    await actor.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(new FormData(startTime.closest("form") ?? undefined).get("startTime")).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: "/venues", search: {} });
  });
});
