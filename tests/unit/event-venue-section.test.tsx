// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { EventProjection, EventVenueRequest } from "#/features/events/access";
import { venueSections } from "#/features/events/components/venue-section";
import type { EventPageData } from "#/features/events/page-data";

const {
  dismissVenueRequest,
  convertVenueHold,
  releaseVenueHold,
  requestVenueHold,
  withdrawVenueHoldRequest,
  invalidate,
  dismissSuccess,
} = vi.hoisted(() => ({
  dismissVenueRequest: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
  convertVenueHold: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  releaseVenueHold: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
  requestVenueHold: vi.fn<(input: { data: unknown }) => Promise<unknown>>(),
  withdrawVenueHoldRequest: vi.fn<(input: { data: { id: string } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  dismissSuccess: vi.fn<(message: string) => void>(),
}));

vi.mock("sonner", () => ({ toast: { success: dismissSuccess } }));

// Every server function that the venue hold actions import, so rendering a hold row never leaves
// one of them undefined.
vi.mock("#/features/venue-requests/server-fns", () => ({
  dismissVenueRequest,
  convertVenueHold,
  releaseVenueHold,
  requestVenueHold,
  withdrawVenueHoldRequest,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate, navigate: () => Promise.resolve() }),
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

/** PTR-165: a settled entry the assigned Coordinator can dismiss. */
const dismissableRejected = {
  ...rejectedAdjustable,
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
    expect(screen.getByText("5 Dec 2026, 17:00 – 21:00")).toBeTruthy();
    expect(screen.getByText("6 Dec 2026, 10:00 – 12:00")).toBeTruthy();
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
          rejection: { ...rejectedAdjustable.rejection, venueId: 5 },
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
      "Harbor Hall, 5 Dec 2026, 17:00 – 21:00",
      "Second Hall, 6 Dec 2026, 10:00 – 12:00",
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

  it("mounts a review status without requests for the coordinator search only", () => {
    for (const status of ["submitted", "under_review", "awaiting_organiser"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(true);
      expect(isVenueVisible("organiser", { status })).toBe(false);
    }
  });

  it.each(["submitted", "under_review", "awaiting_organiser"] as const)(
    "lists the pending and approved requests while the event is %s (PTR-138 AC5)",
    status => {
      for (const access of ["organiser", "coordinator"] as const) {
        const venueRequests = [{ ...pendingEntry }, { ...approvedEntry }];
        expect(isVenueVisible(access, { status, venueRequests })).toBe(true);

        const { unmount } = renderVenue(access, { status, venueRequests });
        expect(screen.getByText("Harbor Hall")).toBeTruthy();
        expect(screen.getByText("5 Dec 2026, 17:00 – 21:00")).toBeTruthy();
        expect(screen.getByText("Pending")).toBeTruthy();
        expect(screen.getByText("Second Hall")).toBeTruthy();
        expect(screen.getByText("6 Dec 2026, 10:00 – 12:00")).toBeTruthy();
        expect(screen.getByText("Approved")).toBeTruthy();
        unmount();
      }
    }
  );

  it("shows a requested hold with its note and the Coordinator's withdrawal (PTR-151)", () => {
    const holdRequests = [
      {
        id: "hold-1",
        venueName: "Harbor Hall",
        startsAt: "2026-12-05T17:00:00",
        endsAt: "2026-12-05T21:00:00",
      },
    ];
    expect(isVenueVisible("coordinator", { status: "submitted", holdRequests })).toBe(true);
    expect(isVenueVisible("organiser", { status: "submitted", holdRequests })).toBe(false);

    renderVenue("coordinator", { status: "planning", holdRequests });

    expect(screen.getByText("Hold requests")).toBeTruthy();
    expect(screen.getByText("Hold requested")).toBeTruthy();
    expect(screen.getByText("5 Dec 2026, 17:00 – 21:00")).toBeTruthy();
    expect(screen.getByText(/protects nothing until Venue Staff place it/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Withdraw hold request" })).toBeTruthy();
  });

  it("does not list a requested hold for the organiser", () => {
    renderVenue("organiser", {
      status: "planning",
      holdRequests: [
        {
          id: "hold-1",
          venueName: "Harbor Hall",
          startsAt: "2026-12-05T17:00:00",
          endsAt: "2026-12-05T21:00:00",
        },
      ],
    });

    // The server projection sends hold requests to the Coordinator only. The view also drops any
    // value it does receive, so an organiser never sees the hold or its action.
    expect(screen.queryByText("Hold requests")).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw hold request" })).toBeNull();
  });

  it("always shows approved, planning and confirmed events", () => {
    for (const status of ["approved", "planning", "confirmed"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(true);
      expect(isVenueVisible("organiser", { status })).toBe(true);
    }
  });

  it("hides rejected, cancelled and completed events", () => {
    const venueRequests = [{ ...pendingEntry }, { ...approvedEntry }];
    for (const status of ["rejected", "cancelled", "completed"] as const) {
      expect(isVenueVisible("coordinator", { status })).toBe(false);
      expect(isVenueVisible("organiser", { status })).toBe(false);
      expect(isVenueVisible("organiser", { status, venueRequests })).toBe(false);
    }
  });

  it("shows the triage venue entries read-only, with the rejection reason and no adjust link", () => {
    const data = {
      kind: "triage",
      request: {
        id: 1036,
        status: "submitted",
        expectedAttendance: 60,
        roomLayoutPreference: "Workshop rows",
        accessibilityRequirements: "",
        venueRequirements: "10 power sockets, whiteboards",
        venueRequests: [{ ...approvedEntry }, { ...rejectedAdjustable }],
      },
    } as unknown as EventPageData;
    const defs = venueSections(data);
    expect(defs).toHaveLength(1);
    expect(defs[0].visible(data)).toBe(true);
    render(<>{defs[0].render(data)}</>);

    expect(screen.getByRole("heading", { name: "Venue" })).toBeTruthy();
    expect(screen.getByText("The main hall is being rewired that weekend.")).toBeTruthy();
    // PTR-144: the Lead reads this detail; the Coordinator's adjust action must not render.
    expect(screen.queryByRole("link", { name: /Adjust request/ })).toBeNull();
  });

  it("hides the triage adjust link when the rejected entry is not adjustable", () => {
    const data = {
      kind: "triage",
      request: {
        id: 1036,
        status: "submitted",
        expectedAttendance: 60,
        roomLayoutPreference: "Workshop rows",
        accessibilityRequirements: "",
        venueRequirements: "10 power sockets, whiteboards",
        venueRequests: [{ ...rejectedAnswered }, { ...approvedEntry }],
      },
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
      // PTR-165 AC1: the adjusted request replaces the rejected one, automatically.
      replacesRequestId: "vr-3",
    });
  });
});

describe("dismissing a settled request (PTR-165 AC4)", () => {
  it("offers the assigned Coordinator a dismiss action that confirms first", async () => {
    const user = userEvent.setup();
    dismissVenueRequest.mockResolvedValueOnce({ id: "vr-3" });
    renderVenue("coordinator", {
      status: "planning",
      venueRequests: [{ ...dismissableRejected }],
    });

    // The row also offers "Adjust request"; the dismissal has its own term so the two do not
    // repeat "Next step" in one description list.
    expect(screen.getByText("Or dismiss")).toBeTruthy();
    const dismiss = screen.getByRole("button", {
      name: "Dismiss request for Harbor Hall, 5 Dec 2026, 17:00 – 21:00",
    });
    await user.click(dismiss);
    // Do not dismiss the request until the user confirms in the dialog.
    expect(dismissVenueRequest).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Harbor Hall");
    expect(dialog.textContent).toContain("cannot be undone");

    await user.click(within(dialog).getByRole("button", { name: "Dismiss request" }));

    await waitFor(() => {
      expect(dismissVenueRequest).toHaveBeenCalledWith({ data: { id: "vr-3" } });
    });
    expect(dismissSuccess).toHaveBeenCalledWith("Request dismissed.");
    expect(invalidate).toHaveBeenCalled();
  });

  it("names a released row a booking in its dismissal (PTR-165 AC4)", async () => {
    const user = userEvent.setup();
    renderVenue("coordinator", {
      status: "planning",
      venueRequests: [{ ...releasedEntry }],
    });

    await user.click(
      screen.getByRole("button", {
        name: "Dismiss booking for Harbor Hall, 5 Dec 2026, 17:00 – 21:00",
      })
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Dismiss this booking?");
    expect(dialog.textContent).not.toContain("Dismiss this request?");
  });

  it("shows the dismissed state and hides the action once it is dismissed", () => {
    renderVenue("coordinator", {
      status: "planning",
      venueRequests: [{ ...dismissableRejected, dismissed: true }],
    });

    expect(screen.getByText("Dismissed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Dismiss request/ })).toBeNull();
  });

  it("hides the dismiss action outside the coordinator's own event", () => {
    renderVenue("organiser", {
      status: "planning",
      venueRequests: [{ ...dismissableRejected }],
    });

    expect(screen.queryByRole("button", { name: /^Dismiss request/ })).toBeNull();
  });
});
