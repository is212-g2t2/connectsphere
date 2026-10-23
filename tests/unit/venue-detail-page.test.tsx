// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VenueDetailPage,
  venueSearchFromPrefill,
} from "#/features/venues/components/venue-detail-page";
import { DEFAULT_OPERATING_HOURS, INITIAL_ROOM_LAYOUTS } from "#/features/venues/schema";
import type { SessionUser } from "#/features/auth/session";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import type { Venue } from "#/features/venues/server-fns";

/** PTR-75 criterion 4: page views must render without a router. The views used to live in route
 * files and call `Route.useRouteContext()`. Tests then needed a router, memory history, and route
 * tree. Views now take route data as props. Mock the venue page's `navigate` and `invalidate`
 * hooks, as `login-form.test.tsx` does for forms.
 */
const { routerInvalidate } = vi.hoisted(() => ({
  routerInvalidate: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  // Compose params and search so tests can read each link's destination.
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | number>;
  }) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    const query = new URLSearchParams(
      Object.entries(search ?? {}).map(([key, value]) => [key, String(value)])
    ).toString();
    return <a href={query ? `${href}?${query}` : href}>{children}</a>;
  },
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ invalidate: routerInvalidate }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function userWithRole(role: string): SessionUser {
  return { id: "usr_1", email: "casey@example.com", name: "Casey", role };
}

const venue: Venue = {
  id: 7,
  name: "Great Hall",
  location: "Level 2, East Wing",
  maxCapacity: 200,
  setupMinutes: 0,
  turnaroundMinutes: 0,
  facilities: ["Projector"],
  accessibilityFeatures: ["Step-free access"],
  supportedLayouts: ["theatre", "banquet"],
  operatingHours: DEFAULT_OPERATING_HOURS,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

describe("VenueDetailPage", () => {
  it("shows the read-only record to a role that may not update it", () => {
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.getByRole("heading", { name: "Great Hall" })).toBeTruthy();
    expect(screen.getByText("Level 2, East Wing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save venue" })).toBeNull();
  });

  it("shows the edit form to Venue Staff, and the banner a fresh record arrives with", () => {
    render(
      <VenueDetailPage
        user={userWithRole("venue_staff")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.getByRole("button", { name: "Save venue" })).toBeTruthy();
    expect(screen.getByText("Venue saved.")).toBeTruthy();
  });

  it("links Check availability to the venue when no event is present", () => {
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    const availability = screen.getByRole("link", { name: "Check availability" });
    expect(availability.getAttribute("href")).toBe(`/venues/availability?venueId=${venue.id}`);
    expect(screen.queryByText(/use Find venues for this event/)).toBeNull();
  });

  it("guards a reload while the edit is dirty", async () => {
    render(
      <VenueDetailPage
        user={userWithRole("venue_staff")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText("Venue name", { exact: true }), {
      target: { value: "Grand Hall" },
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("disabled")).toBeNull();
    });

    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it("reports a failed request-context load and retries it instead of sending the Coordinator back", async () => {
    const user = userEvent.setup();
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed
      />
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load this venue's request panel."
    );
    // Show the dead-end search hint when no event exists, not after a temporary failure.
    expect(screen.queryByRole("link", { name: "dashboard" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(routerInvalidate).toHaveBeenCalled();
  });

  it("does not offer the request hint to a role without venue_request:request", () => {
    render(
      <VenueDetailPage
        user={userWithRole("venue_staff")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.queryByText(/use Find venues for this event/)).toBeNull();
  });

  /** PTR-31: sending or withdrawing changes the list of requests. Without focus management, focus
   * falls to `<body>` and the changed list goes unannounced. Move focus to the list heading only
   * when the rows change within the same event and venue, not on first render.
   */
  it("focuses the list heading when the requests change, but not on first paint", () => {
    const openContext: VenueRequestContext = {
      event: {
        id: 12,
        name: "Annual Gala",
        eventDate: "2026-10-12",
        endDate: "2026-10-12",
        startTime: "14:30",
        endTime: "18:45",
        expectedAttendance: 80,
        layout: "Theatre seating",
        accessibilityRequirements: "Step-free access",
        requiredFacilities: "Projector, PA system",
      },
      canRequest: true,
      replaceable: [],
      requests: [],
    };
    const { rerender } = render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={openContext}
        requestContextFailed={false}
      />
    );

    expect(document.activeElement).toBe(document.body);

    rerender(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={{
          ...openContext,
          requests: [
            {
              id: "req-1",
              startsAt: "2026-10-12T14:30",
              endsAt: "2026-10-12T18:45",
              status: "pending",
              conflict: null,
              rejectionReason: null,
              releaseReason: null,
              answered: false,
              dismissed: false,
              requirements: {
                expectedAttendance: 80,
                layout: "Theatre seating",
              },
              canWithdraw: true,
            },
          ],
        }}
        requestContextFailed={false}
      />
    );

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Requests for Annual Gala" })
    );
  });
});

describe("venueSearchFromPrefill", () => {
  it("preserves the event and maps the requirement names back to the search", () => {
    expect(
      venueSearchFromPrefill(41, {
        date: "2026-10-12",
        startTime: "14:00",
        endTime: "16:00",
        expectedAttendance: 30,
        layout: "Boardroom",
        accessibilityRequirements: "Step-free access",
        requiredFacilities: "Projector",
      })
    ).toEqual({
      eventId: 41,
      date: "2026-10-12",
      startTime: "14:00",
      endTime: "16:00",
      expectedAttendance: 30,
      layout: "Boardroom",
      accessibility: "Step-free access",
      facilities: "Projector",
    });
  });

  it("leaves out what the search never carried", () => {
    expect(venueSearchFromPrefill(undefined, null)).toEqual({});
    expect(venueSearchFromPrefill(41, {})).toEqual({ eventId: 41 });
    expect(venueSearchFromPrefill(undefined, { layout: "" })).toEqual({});
  });
});

describe("VenueDetailPage discovery links", () => {
  const prefill = {
    date: "2026-10-12",
    startTime: "14:00",
    endTime: "16:00",
    expectedAttendance: 30,
    layout: "Boardroom",
    accessibilityRequirements: "Step-free access",
    requiredFacilities: "Projector",
  };

  it("offers a primary Check availability link for the venue calendar", () => {
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.getByRole("link", { name: "Check availability" }).getAttribute("href")).toBe(
      "/venues/availability?venueId=7"
    );
  });

  it("carries the searched date into the Check availability link when present", () => {
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
        eventId={41}
        prefill={prefill}
      />
    );

    expect(screen.getByRole("link", { name: "Check availability" }).getAttribute("href")).toBe(
      "/venues/availability?venueId=7&startDate=2026-10-12&endDate=2026-10-12"
    );
  });

  it("returns to the filtered results through the back slot when a search led here", () => {
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
        eventId={41}
        prefill={prefill}
      />
    );

    expect(screen.getByRole("link", { name: "Back to venues" }).getAttribute("href")).toBe(
      "/venues?eventId=41&date=2026-10-12&startTime=14%3A00&endTime=16%3A00&expectedAttendance=30&layout=Boardroom&accessibility=Step-free+access&facilities=Projector"
    );
  });

  it("links to the event's venue search only when an event is present", () => {
    const { rerender } = render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
        prefill={prefill}
      />
    );

    expect(screen.queryByRole("link", { name: "More venues for this event" })).toBeNull();

    rerender(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
        eventId={41}
        prefill={prefill}
      />
    );

    expect(
      screen.getByRole("link", { name: "More venues for this event" }).getAttribute("href")
    ).toBe("/venues?eventId=41");
  });

  it("repeats the requirements from the search that led here", () => {
    const { rerender } = render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.queryByRole("region", { name: "Your search" })).toBeNull();

    rerender(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        layouts={INITIAL_ROOM_LAYOUTS}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
        eventId={41}
        prefill={prefill}
      />
    );

    const search = screen.getByRole("region", { name: "Your search" });
    expect(within(search).getByText("2026-10-12, 14:00–16:00")).toBeTruthy();
    expect(within(search).getByText("Boardroom")).toBeTruthy();
    expect(within(search).getByText("Step-free access")).toBeTruthy();
    expect(within(search).getByText("Projector")).toBeTruthy();
  });
});
