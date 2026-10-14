// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EventProjection, EventVenueRequest } from "#/features/events/access";
import { venueSections } from "#/features/events/components/venue-section";
import type { EventPageData } from "#/features/events/page-data";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, unknown>;
    params?: Record<string, unknown>;
    className?: string;
  }) => (
    <a href={to} data-search={JSON.stringify(search ?? null)}>
      {children}
    </a>
  ),
}));

function projection(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]> = {}
): EventProjection {
  return {
    access,
    event: {
      id: 1042,
      eventDate: "2026-11-04",
      startTime: "10:00",
      endTime: "16:00",
      status: "confirmed",
      expectedAttendance: 60,
      ...event,
    },
  };
}

function eventData(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]>
): EventPageData {
  return {
    kind: "event",
    viewerId: "viewer-1",
    event: projection(access, event),
  };
}

function renderVenue(access: EventProjection["access"], event: Partial<EventProjection["event"]>) {
  const data = eventData(access, event);
  const defs = venueSections(data);
  expect(defs).toHaveLength(1);
  return render(<>{defs[0].render(data)}</>);
}

function isVenueVisible(
  access: EventProjection["access"],
  event: Partial<EventProjection["event"]>
): boolean {
  const data = eventData(access, event);
  return venueSections(data).some(section => section.visible(data));
}

const pendingEntry = {
  id: "vr-1",
  status: "pending",
  venueName: "Harbor Hall",
  date: "2026-12-05",
  startTime: "17:00",
  endTime: "21:00",
  conflict: "booking",
} satisfies EventVenueRequest;

const approvedEntry = {
  id: "vr-2",
  status: "approved",
  venueName: "Second Hall",
  date: "2026-12-06",
  startTime: "10:00",
  endTime: "12:00",
} satisfies EventVenueRequest;

const rejectedAdjustable = {
  id: "vr-3",
  status: "rejected",
  venueName: "Harbor Hall",
  date: "2026-12-05",
  startTime: "17:00",
  endTime: "21:00",
  adjustable: true,
  rejection: {
    venueId: 3,
    venueName: "Harbor Hall",
    date: "2026-12-05",
    startTime: "17:00",
    endTime: "21:00",
    reason: "The main hall is being rewired that weekend.",
    suggestion: null,
    suggestedVenueId: null,
  },
} satisfies EventVenueRequest;

const rejectedAnswered = {
  id: "vr-3",
  status: "rejected",
  venueName: "Harbor Hall",
  date: "2026-12-05",
  startTime: "17:00",
  endTime: "21:00",
  rejection: {
    venueId: 3,
    venueName: "Harbor Hall",
    date: "2026-12-05",
    startTime: "17:00",
    endTime: "21:00",
    reason: "The main hall is being rewired that weekend.",
    suggestion: null,
    suggestedVenueId: null,
  },
} satisfies EventVenueRequest;

const releasedEntry = {
  id: "vr-4",
  status: "released",
  venueName: "Harbor Hall",
  date: "2026-12-05",
  startTime: "17:00",
  endTime: "21:00",
  release: {
    reason: "The organiser moved the session.",
    changedByName: "Ruth Staff",
  },
} satisfies EventVenueRequest;

describe("venue section", () => {
  it("shows the confirmed booking for the organiser", () => {
    renderVenue("organiser", {
      confirmation: {
        confirmedAt: "2026-09-28T09:41:00.000Z",
        confirmedByName: "Jonas Weber",
        venue: {
          name: "Harbor Hall, 12 Dock Street",
          location: "12 Dock Street",
          date: "2026-11-04",
          endDate: "2026-11-04",
          startTime: "10:00",
          endTime: "16:00",
        },
      },
    });

    expect(screen.getByText("Harbor Hall, 12 Dock Street")).toBeTruthy();
    expect(screen.getByText(/Jonas Weber/)).toBeTruthy();
  });

  it("renders one block per entry with venue, period, and state badges", () => {
    renderVenue("coordinator", {
      status: "planning",
      venueRequests: [{ ...pendingEntry }, { ...approvedEntry }],
    });

    expect(screen.getByText("Harbor Hall")).toBeTruthy();
    expect(screen.getByText("Second Hall")).toBeTruthy();
    expect(screen.getByText("5 Dec 2026, 17:00–21:00")).toBeTruthy();
    expect(screen.getByText("6 Dec 2026, 10:00–12:00")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Conflicting booking")).toBeTruthy();
  });

  it("shows every rejected entry's reason, and the adjust link on each adjustable entry", () => {
    const { unmount } = renderVenue("coordinator", {
      status: "submitted",
      venueRequests: [{ ...rejectedAdjustable }, { ...approvedEntry }],
    });

    // A later booking at another venue leaves the rejected entry adjustable.
    expect(screen.getByText("The main hall is being rewired that weekend.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Adjust request at Harbor Hall" })).toBeTruthy();
    unmount();

    renderVenue("coordinator", {
      status: "submitted",
      venueRequests: [
        { ...rejectedAdjustable },
        {
          ...rejectedAdjustable,
          id: "vr-5",
          venueName: "Second Hall",
          rejection: { ...rejectedAdjustable.rejection, venueId: 5, venueName: "Second Hall" },
        },
      ],
    });

    // The flag is per entry: two adjustable rejections give two links.
    expect(screen.getAllByText("The main hall is being rewired that weekend.")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Adjust request at Harbor Hall" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Adjust request at Second Hall" })).toBeTruthy();
  });

  it("hides the adjust link once a newer request answers the rejection", () => {
    renderVenue("coordinator", {
      status: "submitted",
      venueRequests: [{ ...rejectedAnswered }, { ...pendingEntry }],
    });

    expect(screen.getByText("The main hall is being rewired that weekend.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Adjust request/ })).toBeNull();
  });

  it("gives each entry its own named description list beside the requirements", () => {
    const { container } = renderVenue("coordinator", {
      status: "planning",
      venueRequests: [{ ...pendingEntry }, { ...approvedEntry }],
    });

    // The requirements list and one list per entry sit side by side; no list nests in another.
    const lists = [...container.querySelectorAll("dl")];
    expect(lists.map(list => list.getAttribute("aria-label"))).toEqual([
      null,
      "Harbor Hall, 5 Dec 2026, 17:00–21:00",
      "Second Hall, 6 Dec 2026, 10:00–12:00",
    ]);
    expect(container.querySelector("dl dl")).toBeNull();
    expect(screen.queryAllByRole("group")).toHaveLength(0);
    // Every list holds only term and description groups.
    for (const list of lists) {
      for (const child of list.children) {
        expect([...child.children].map(node => node.tagName)).toEqual(["DT", "DD"]);
      }
    }
  });

  it("keeps the rejection reason without the adjust link outside searchable statuses", () => {
    renderVenue("coordinator", {
      status: "confirmed",
      venueRequests: [{ ...rejectedAdjustable }],
    });

    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("The main hall is being rewired that weekend.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Adjust request/ })).toBeNull();
  });

  it("shows release details to the coordinator and none to the organiser", () => {
    const { unmount } = renderVenue("coordinator", {
      status: "planning",
      venueRequests: [{ ...approvedEntry }, { ...releasedEntry }],
    });

    expect(screen.getByText("Released")).toBeTruthy();
    expect(screen.getByText("The organiser moved the session.")).toBeTruthy();
    expect(screen.getByText("Ruth Staff")).toBeTruthy();
    unmount();

    renderVenue("organiser", {
      status: "planning",
      venueRequests: [{ ...pendingEntry, conflict: undefined }, { ...approvedEntry }],
    });

    expect(screen.getByText("Harbor Hall")).toBeTruthy();
    expect(screen.getByText("Second Hall")).toBeTruthy();
    expect(screen.queryByText("The main hall is being rewired that weekend.")).toBeNull();
    expect(screen.queryByText("The organiser moved the session.")).toBeNull();
    expect(screen.queryByRole("link", { name: /Adjust request/ })).toBeNull();
  });

  it("keeps review statuses mounted for the coordinator search only", () => {
    for (const status of ["submitted", "under_review", "awaiting_organiser"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(true);
      expect(isVenueVisible("organiser", { status })).toBe(false);
    }
    expect(
      isVenueVisible("coordinator", {
        status: "submitted",
        venueRequests: [{ ...rejectedAnswered }],
      })
    ).toBe(true);
    expect(
      isVenueVisible("organiser", {
        status: "submitted",
        venueRequests: [{ ...rejectedAnswered }],
      })
    ).toBe(false);
  });

  it("always shows approved, planning and confirmed events", () => {
    for (const status of ["approved", "planning", "confirmed"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(true);
      expect(isVenueVisible("organiser", { status })).toBe(true);
    }
  });

  it("hides rejected, cancelled and completed events", () => {
    for (const status of ["rejected", "cancelled", "completed"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(false);
      expect(isVenueVisible("organiser", { status })).toBe(false);
    }
  });

  it("shows the triage venue entries with the rejection reason and the adjust link", () => {
    const data = {
      kind: "triage",
      viewerId: "viewer-1",
      request: {
        id: 1036,
        status: "submitted",
        expectedAttendance: 60,
        roomLayoutPreference: "Workshop rows",
        accessibilityRequirements: "",
        venueRequirements: "10 power sockets, whiteboards",
        venueRequests: [{ ...approvedEntry }, { ...rejectedAdjustable }],
      },
      coordinators: [],
    } as unknown as EventPageData;
    const defs = venueSections(data);
    expect(defs).toHaveLength(1);
    expect(defs[0].visible(data)).toBe(true);
    render(<>{defs[0].render(data)}</>);

    expect(screen.getByRole("heading", { name: "Venue" })).toBeTruthy();
    expect(screen.getByText("The main hall is being rewired that weekend.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Adjust request at Harbor Hall" })).toBeTruthy();
  });

  it("hides the triage adjust link when the rejected entry is not adjustable", () => {
    const data = {
      kind: "triage",
      viewerId: "viewer-1",
      request: {
        id: 1036,
        status: "submitted",
        expectedAttendance: 60,
        roomLayoutPreference: "Workshop rows",
        accessibilityRequirements: "",
        venueRequirements: "10 power sockets, whiteboards",
        venueRequests: [{ ...rejectedAnswered }, { ...approvedEntry }],
      },
      coordinators: [],
    } as unknown as EventPageData;
    const defs = venueSections(data);
    render(<>{defs[0].render(data)}</>);

    expect(screen.getByText("Second Hall")).toBeTruthy();
    expect(screen.getByText("The main hall is being rewired that weekend.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Adjust request/ })).toBeNull();
  });

  it("hides the triage venue without venue entries", () => {
    const data = {
      kind: "triage",
      viewerId: "viewer-1",
      request: { id: 1036, status: "submitted", venueRequests: [] },
      coordinators: [],
    } as unknown as EventPageData;

    expect(venueSections(data).some(section => section.visible(data))).toBe(false);
  });

  it("hides the adjust-request link from the organiser", () => {
    renderVenue("organiser", {
      status: "submitted",
      venueRequests: [{ ...rejectedAdjustable }],
    });

    expect(screen.queryByRole("link", { name: /Adjust request/ })).toBeNull();
  });

  it("offers the venue search to the coordinator while the event is searchable", () => {
    renderVenue("coordinator", { status: "planning" });

    expect(screen.getByRole("link", { name: "Find venues for this event" })).toBeTruthy();
  });

  it("hides the venue search from the organiser", () => {
    renderVenue("organiser", { status: "planning" });

    expect(screen.queryByRole("link", { name: "Find venues for this event" })).toBeNull();
  });
});

/** PTR-138 AC1: each Coordinator entry names its session, and an adjusted request carries it. */
describe("venue section session requirements", () => {
  const breakout = {
    expectedAttendance: 30,
    layout: "Boardroom",
    accessibilityRequirements: "",
    requiredFacilities: "",
  };

  it("names each entry's attendance and layout, so two sessions at one venue stay apart", () => {
    renderVenue("coordinator", {
      status: "planning",
      venueRequests: [
        { ...pendingEntry, requirements: breakout },
        {
          ...approvedEntry,
          venueName: "Harbor Hall",
          requirements: { ...breakout, expectedAttendance: 120, layout: "Theatre seating" },
        },
      ],
    });

    expect(screen.getAllByText("Session")).toHaveLength(2);
    expect(screen.getByText("30 attendees, Boardroom")).toBeTruthy();
    expect(screen.getByText("120 attendees, Theatre")).toBeTruthy();
  });

  it("shows no session on an entry without requirements, such as the organiser's", () => {
    renderVenue("organiser", {
      status: "planning",
      venueRequests: [{ ...pendingEntry }],
    });

    expect(screen.queryByText("Session")).toBeNull();
  });

  it("carries the rejected session's requirements in the adjust link", () => {
    renderVenue("coordinator", {
      status: "submitted",
      venueRequests: [{ ...rejectedAdjustable, requirements: breakout }],
    });

    const link = screen.getByRole("link", { name: "Adjust request at Harbor Hall" });
    expect(JSON.parse(link.dataset.search ?? "null")).toEqual({
      eventId: 1042,
      date: "2026-12-05",
      startTime: "17:00",
      endTime: "21:00",
      expectedAttendance: 30,
      layout: "Boardroom",
      accessibilityRequirements: "",
      requiredFacilities: "",
    });
  });
});
