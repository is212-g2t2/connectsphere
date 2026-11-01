// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EventRow, isActionableRow } from "#/features/events/components/event-row";
import { eventTitle } from "#/features/events/components/event-title";
import type { EventAccess, EventProjection } from "#/features/events/access";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => {
    let href = to;
    for (const [key, value] of Object.entries(params ?? {})) {
      href = href.replace(`$${key}`, value);
    }
    return <a href={href}>{children}</a>;
  },
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
}));
vi.mock("#/features/events/server-fns", () => ({
  withdrawFromEvent: vi.fn<() => Promise<unknown>>(),
}));

function projection(access: EventAccess, event: EventProjection["event"]): EventProjection {
  return { access, event };
}

const timed = {
  id: 7,
  name: "ConnectSphere Open Day",
  description: "An open day for new members.",
  eventDate: "2026-11-04",
  startTime: "10:00",
  endTime: "16:00",
  status: "confirmed",
  registrationEnabled: true,
} as const;

type EquipmentLine = NonNullable<EventProjection["event"]["equipment"]>[number];

function equipmentLine(arrangeable?: boolean): EquipmentLine {
  return {
    id: "line-1",
    item: "Projector",
    quantity: 1,
    arrangementStatus: "requested",
    notes: null,
    ...(arrangeable === undefined ? {} : { arrangeable }),
  };
}

describe("eventTitle", () => {
  it("titles a venue staff row with each distinct venue, in list order", () => {
    expect(
      eventTitle(
        projection("venue_staff", {
          id: 7,
          eventDate: "2026-10-01",
          startTime: "09:00",
          endTime: "17:00",
          status: "submitted",
          venueRequests: [
            {
              id: "vr-1",
              status: "approved",
              venueName: "Second Hall",
              date: "2026-12-06",
              startTime: "10:00",
              endTime: "12:00",
            },
            {
              id: "vr-2",
              status: "pending",
              venueName: "Harbor Hall",
              date: "2026-12-07",
              startTime: "17:00",
              endTime: "21:00",
            },
            {
              id: "vr-3",
              status: "pending",
              venueName: "Second Hall",
              date: "2026-12-08",
              startTime: "10:00",
              endTime: "12:00",
            },
          ],
        })
      )
    ).toBe("Second Hall, Harbor Hall");
  });

  it("titles an untitled event without venue entries", () => {
    expect(
      eventTitle(
        projection("organiser", {
          id: 7,
          eventDate: null,
          startTime: null,
          endTime: null,
          status: "draft",
        })
      )
    ).toBe("Untitled event");
    expect(
      eventTitle(
        projection("venue_staff", {
          id: 7,
          eventDate: null,
          startTime: null,
          endTime: null,
          status: "submitted",
          venueRequests: [],
        })
      )
    ).toBe("Venue request");
  });
});

describe("EventRow", () => {
  it("links a staff row title and scopes its status pill by entity", () => {
    render(
      <EventRow
        projection={projection("coordinator", {
          ...timed,
          status: "submitted",
        })}
      />
    );

    expect(screen.getByRole("link", { name: "ConnectSphere Open Day" }).getAttribute("href")).toBe(
      "/events/7"
    );
    expect(screen.getByText("Event: Submitted")).toBeTruthy();
    expect(screen.getByText("4 Nov 2026")).toBeTruthy();
    expect(screen.getByText("10:00–16:00")).toBeTruthy();
  });

  it("lists each venue staff request with its venue, period, and scoped pill", () => {
    render(
      <EventRow
        projection={projection("venue_staff", {
          id: 7,
          eventDate: "2026-10-01",
          startTime: "09:00",
          endTime: "17:00",
          status: "submitted",
          venueRequests: [
            {
              id: "vr-1",
              status: "pending",
              venueName: "Harbor Hall",
              date: "2026-12-05",
              startTime: "17:00",
              endTime: "21:00",
            },
            {
              id: "vr-2",
              status: "pending",
              venueName: "Second Hall",
              date: "2026-12-06",
              startTime: "10:00",
              endTime: "12:00",
            },
          ],
        })}
      />
    );

    expect(screen.getByRole("link", { name: "Harbor Hall, Second Hall" })).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "Booking requests" })).getAllByRole(
      "listitem"
    );
    expect(items.map(item => item.textContent)).toEqual([
      "Harbor Hall5 Dec 2026, 17:00 – 21:00Venue request: Pending",
      "Second Hall6 Dec 2026, 10:00 – 12:00Venue request: Pending",
    ]);
    // Each entry shows its own period, so the event's proposed date and time stay off the row.
    expect(screen.queryByText("1 Oct 2026")).toBeNull();
    expect(screen.queryByText("09:00–17:00")).toBeNull();
  });

  it("omits the entry venue name when one venue covers the row", () => {
    render(
      <EventRow
        projection={projection("venue_staff", {
          id: 7,
          eventDate: "2026-10-01",
          startTime: "09:00",
          endTime: "17:00",
          status: "submitted",
          venueRequests: [
            {
              id: "vr-1",
              status: "pending",
              venueName: "Harbor Hall",
              date: "2026-12-05",
              startTime: "17:00",
              endTime: "21:00",
            },
            {
              id: "vr-2",
              status: "approved",
              venueName: "Harbor Hall",
              date: "2026-12-06",
              startTime: "10:00",
              endTime: "12:00",
            },
          ],
        })}
      />
    );

    // The title already names Harbor Hall, so the entries show periods and pills only.
    expect(screen.getByRole("link", { name: "Harbor Hall" })).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "Booking requests" })).getAllByRole(
      "listitem"
    );
    expect(items.map(item => item.textContent)).toEqual([
      "5 Dec 2026, 17:00 – 21:00Venue request: Pending",
      "6 Dec 2026, 10:00 – 12:00Venue request: Approved",
    ]);
  });

  it("reads Assigned and Unassigned on lead rows instead of the event status", () => {
    const { unmount } = render(
      <EventRow
        projection={projection("lead", {
          ...timed,
          status: "submitted",
          awaitingAssignment: true,
        })}
      />
    );
    expect(screen.getByText("Unassigned")).toBeTruthy();
    expect(screen.queryByText("Event: Submitted")).toBeNull();
    unmount();

    render(
      <EventRow
        projection={projection("lead", {
          ...timed,
          status: "planning",
          awaitingAssignment: false,
        })}
      />
    );
    expect(screen.getByText("Assigned")).toBeTruthy();
  });

  it("gives a registered attendee on a non-confirmed event a withdraw action, not a link", () => {
    render(
      <EventRow
        projection={projection("attendee", {
          ...timed,
          status: "under_review",
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })}
      />
    );

    expect(screen.queryByRole("link", { name: "ConnectSphere Open Day" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw registration" })).toBeTruthy();
  });

  it("links a registered attendee on a confirmed event with no withdraw action", () => {
    render(
      <EventRow
        projection={projection("attendee", {
          ...timed,
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })}
      />
    );

    expect(screen.getByRole("link", { name: "ConnectSphere Open Day" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Withdraw registration" })).toBeNull();
    expect(screen.getByText("Registered")).toBeTruthy();
  });

  it("marks waiting-list and dead states without an action", () => {
    const { unmount } = render(
      <EventRow
        projection={projection("attendee", {
          ...timed,
          registration: { status: "waitlisted", registeredAt: "2026-11-02T03:04:05.000Z" },
        })}
      />
    );
    expect(screen.getByText("Waiting list")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Withdraw registration" })).toBeNull();
    unmount();

    render(
      <EventRow
        projection={projection("attendee", {
          ...timed,
          status: "completed",
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })}
      />
    );
    expect(screen.queryByRole("link", { name: "ConnectSphere Open Day" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw registration" })).toBeNull();
  });

  it("renders a bare row with no date block, meta, or description when the event has none", () => {
    const { container } = render(
      <EventRow
        projection={projection("organiser", {
          id: 7,
          name: "Bare event",
          status: "awaiting_organiser",
          eventDate: null,
          startTime: null,
          endTime: null,
        })}
      />
    );

    expect(screen.getByRole("link", { name: "Bare event" })).toBeTruthy();
    expect(screen.getByText("Event: Awaiting organiser")).toBeTruthy();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("isActionableRow", () => {
  it("flags the organiser's rows waiting on them and the coordinator's submitted rows", () => {
    expect(
      isActionableRow(projection("organiser", { ...timed, status: "awaiting_organiser" }))
    ).toBe(true);
    expect(isActionableRow(projection("organiser", { ...timed, status: "submitted" }))).toBe(false);
    expect(isActionableRow(projection("organiser", { ...timed, status: "approved" }))).toBe(false);
    expect(isActionableRow(projection("coordinator", { ...timed, status: "submitted" }))).toBe(
      true
    );
    expect(isActionableRow(projection("coordinator", { ...timed, status: "under_review" }))).toBe(
      true
    );
    expect(
      isActionableRow(projection("coordinator", { ...timed, status: "awaiting_organiser" }))
    ).toBe(false);
    expect(isActionableRow(projection("coordinator", { ...timed, status: "approved" }))).toBe(
      false
    );
  });

  it("flags unassigned lead rows", () => {
    expect(
      isActionableRow(
        projection("lead", { ...timed, status: "planning", awaitingAssignment: true })
      )
    ).toBe(true);
    expect(
      isActionableRow(
        projection("lead", { ...timed, status: "planning", awaitingAssignment: false })
      )
    ).toBe(false);
  });

  it("flags venue staff rows with a pending request only", () => {
    type VenueRequestEntry = NonNullable<EventProjection["event"]["venueRequests"]>[number];
    const approved: VenueRequestEntry = {
      id: "vr-1",
      status: "approved",
      venueName: "Harbor Hall",
      date: "2026-12-06",
      startTime: "10:00",
      endTime: "12:00",
    };
    const pending: VenueRequestEntry = { ...approved, id: "vr-2", status: "pending" };
    const row = (venueRequests: VenueRequestEntry[]) =>
      projection("venue_staff", {
        id: 7,
        eventDate: "2026-10-01",
        startTime: "09:00",
        endTime: "17:00",
        status: "submitted",
        venueRequests,
      });
    expect(isActionableRow(row([]))).toBe(false);
    expect(isActionableRow(row([approved]))).toBe(false);
    expect(isActionableRow(row([approved, pending]))).toBe(true);
  });

  it("flags technical support rows with an arrangeable line only", () => {
    expect(isActionableRow(projection("technical_support", { ...timed, equipment: [] }))).toBe(
      false
    );
    expect(
      isActionableRow(
        projection("technical_support", { ...timed, equipment: [equipmentLine(false)] })
      )
    ).toBe(false);
    expect(
      isActionableRow(
        projection("technical_support", {
          ...timed,
          equipment: [equipmentLine(false), equipmentLine(true)],
        })
      )
    ).toBe(true);
  });

  it("flags safety officer rows under their reviews only", () => {
    expect(isActionableRow(projection("safety_officer", { ...timed }), [7])).toBe(true);
    expect(isActionableRow(projection("safety_officer", { ...timed }), [])).toBe(false);
    expect(isActionableRow(projection("safety_officer", { ...timed }), [12])).toBe(false);
  });

  it("flags withdrawable attendee registrations", () => {
    expect(
      isActionableRow(
        projection("attendee", {
          ...timed,
          status: "under_review",
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })
      )
    ).toBe(true);
    expect(
      isActionableRow(
        projection("attendee", {
          ...timed,
          status: "confirmed",
          registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
        })
      )
    ).toBe(false);
  });
});
