// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CoordinationPage,
  submittedAge,
} from "#/features/coordination/components/coordination-page";
import type {
  AssignedEventRequest,
  CoordinatorOversight,
} from "#/features/coordination/server-fns";
import type { UnassignedEventRequest } from "#/features/event-requests/server-fns";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params?: { eventId: string };
  }) => <a href={params ? to.replace("$eventId", params.eventId) : to}>{children}</a>,
}));

const waiting: UnassignedEventRequest = {
  id: 7,
  organiserId: "usr_org",
  status: "submitted",
  submittedAt: new Date("2026-09-15T02:00:00Z"),
  assignedCoordinatorId: null,
  assignedAt: null,
  decisionReason: null,
  decidedByCoordinatorId: null,
  decidedByCoordinatorName: null,
  decidedAt: null,
  confirmedById: null,
  confirmedByName: null,
  confirmedAt: null,
  completedById: null,
  completedByName: null,
  completedAt: null,
  cancelledById: null,
  cancelledByName: null,
  cancelledAt: null,
  eventName: "Annual dinner",
  purpose: "Thank the volunteers",
  proposedDates: [{ start: "2030-12-01T18:00", end: "2030-12-01T22:00" }],
  expectedAttendance: 120,
  actualAttendance: null,
  description: "",
  eventType: "",
  venueRequirements: "",
  roomLayoutPreference: "",
  accessibilityRequirements: "",
  equipmentRequirements: [],
  specialArrangements: "",
  registrationEnabled: false,
  registrationCapacity: null,
  registrationOpensAt: null,
  registrationClosesAt: null,
  equipmentSubmittedAt: null,
  equipmentArrangementsCompletedAt: null,
  equipmentArrangementsCompletedById: null,
  createdAt: new Date("2026-09-14T00:00:00Z"),
  updatedAt: new Date("2026-09-15T02:00:00Z"),
  organiser: { name: "Jane Doe", email: "jane.doe@example.com" },
  changeRequestsWaiting: 0,
  cancellationRequested: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

const NOW = new Date("2026-09-18T02:00:00Z");

describe("CoordinationPage lead view (PTR-144)", () => {
  it("lists each unassigned request with its organiser, proposed date and submission time", () => {
    render(
      <CoordinationPage view="lead" unassigned={[waiting]} assigned={[]} oversight={[]} now={NOW} />
    );

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Annual dinner")).toBeTruthy();
    expect(within(row).getByText("Jane Doe")).toBeTruthy();
    // The organiser contact is text, so the title stays the row's only link.
    expect(within(row).queryByRole("link", { name: "jane.doe@example.com" })).toBeNull();
    expect(within(row).getByText("jane.doe@example.com")).toBeTruthy();
    expect(within(row).getByText("1 Dec 2030, 18:00")).toBeTruthy();
    // 02:00 UTC is 10:00 Singapore time. Every instant renders in that zone.
    expect(within(row).getByText("15 Sept 2026, 10:00").tagName).toBe("TIME");
    expect(within(row).getByText("Submitted")).toBeTruthy();
    // The age renders from the loader's `now`: Sept 15 to Sept 18 reads "3 days ago".
    expect(within(row).getByText(/3 days ago/)).toBeTruthy();
  });

  it("heads the queue with one h1 carrying the queue count", () => {
    const { unmount } = render(
      <CoordinationPage view="lead" unassigned={[waiting]} assigned={[]} oversight={[]} now={NOW} />
    );
    expect(screen.getByRole("heading", { name: "Coordination (1)", level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    unmount();

    render(
      <CoordinationPage
        view="coordinator"
        unassigned={[]}
        assigned={[
          {
            ...waiting,
            assignedCoordinatorId: "usr_coord",
            assignedAt: new Date("2026-09-15T03:00:00Z"),
            changeRequestsWaiting: 0,
            venueBlocked: false,
          },
        ]}
        oversight={[]}
        now={NOW}
      />
    );
    expect(screen.getByRole("heading", { name: "Coordination (1)", level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("lists the unassigned queue as mobile rows below sm and keeps the desktop table", () => {
    render(
      <CoordinationPage view="lead" unassigned={[waiting]} assigned={[]} oversight={[]} now={NOW} />
    );

    const mobile = screen.getByRole("list", { name: "Unassigned requests" });
    expect(mobile.getAttribute("class")).toContain("sm:hidden");
    const titleLink = within(mobile).getByRole("link", { name: /Annual dinner/ });
    expect(titleLink.getAttribute("href")).toBe("/events/7");
    // The mobile row keeps the organiser contact and reads the title as a link.
    expect(within(mobile).getByText("jane.doe@example.com")).toBeTruthy();
    expect(within(mobile).getByText("Annual dinner").getAttribute("class")).toContain("underline");
    expect(within(mobile).getByText("Submitted")).toBeTruthy();
    // The desktop table keeps the full columns from sm up.
    const table = screen.getByRole("table");
    expect(table.closest("div.mt-4")?.getAttribute("class")).toContain("hidden");
    expect(table.closest("div.mt-4")?.getAttribute("class")).toContain("sm:block");
  });

  it("counts the submitted age in days", () => {
    const submittedAt = new Date("2026-09-15T02:00:00Z");
    expect(submittedAge(submittedAt, new Date("2026-09-15T09:00:00Z"))).toBe("today");
    expect(submittedAge(submittedAt, new Date("2026-09-16T02:00:00Z"))).toBe("yesterday");
    expect(submittedAge(submittedAt, new Date("2026-09-18T02:00:00Z"))).toBe("3 days ago");
    expect(submittedAge(submittedAt, new Date("2026-09-20T02:00:00Z"))).toBe("5 days ago");
  });

  it("says so when every submitted request already has a Coordinator", () => {
    render(<CoordinationPage view="lead" unassigned={[]} assigned={[]} oversight={[]} now={NOW} />);

    expect(screen.getByText("Every submitted request has a Coordinator.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Review coordinator workloads" }).getAttribute("href")
    ).toBe("#oversight");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("flags an unassigned request with its waiting change and cancellation requests", () => {
    render(
      <CoordinationPage
        view="lead"
        unassigned={[
          { ...waiting, id: 1, eventName: "One waiting", changeRequestsWaiting: 1 },
          { ...waiting, id: 2, eventName: "Two waiting", changeRequestsWaiting: 2 },
          { ...waiting, id: 3, eventName: "Cancel me", cancellationRequested: true },
          { ...waiting, id: 4, eventName: "Quiet one" },
        ]}
        assigned={[]}
        oversight={[]}
        now={NOW}
      />
    );

    // The mobile rows repeat the flags, so pin the desktop table's copies.
    const queueTable = screen.getByRole("table");
    expect(within(queueTable).getByText("1 change request waiting")).toBeTruthy();
    expect(within(queueTable).getByText("2 change requests waiting")).toBeTruthy();
    expect(within(queueTable).getByText("Cancellation requested")).toBeTruthy();
    expect(within(queueTable).getAllByText(/change requests? waiting/)).toHaveLength(2);
  });

  it("shows the Coordinator no unassigned section", () => {
    render(
      <CoordinationPage
        view="coordinator"
        unassigned={[waiting]}
        assigned={[]}
        oversight={[]}
        now={NOW}
      />
    );

    expect(screen.queryByRole("heading", { name: "Unassigned requests" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("CoordinationPage oversight (PTR-149)", () => {
  const ana: CoordinatorOversight = {
    id: "usr_ana",
    name: "Ana Coordinator",
    email: "ana@example.com",
    events: [
      {
        id: 11,
        eventName: "Active gala",
        status: "planning",
        assignedAt: new Date("2026-09-20T02:00:00Z"),
      },
      {
        id: 12,
        eventName: "Finished fair",
        status: "completed",
        assignedAt: new Date("2026-09-10T02:00:00Z"),
      },
      {
        id: 13,
        eventName: "Turned down",
        status: "rejected",
        assignedAt: new Date("2026-09-05T02:00:00Z"),
      },
      {
        id: 14,
        eventName: "Called off",
        status: "cancelled",
        assignedAt: new Date("2026-09-01T02:00:00Z"),
      },
    ],
  };
  const bo: CoordinatorOversight = {
    id: "usr_bo",
    name: "Bo Coordinator",
    email: "bo@example.com",
    events: [],
  };

  it("lists every Coordinator, their active events and their closed events", () => {
    render(
      <CoordinationPage view="lead" unassigned={[]} assigned={[]} oversight={[ana, bo]} now={NOW} />
    );

    const section = screen.getByRole("region", { name: "Coordinator oversight" });
    expect(within(section).getByRole("heading", { name: "Ana Coordinator" })).toBeTruthy();
    expect(within(section).getByRole("link", { name: "ana@example.com" })).toBeTruthy();
    expect(within(section).getByText("1 active event")).toBeTruthy();
    // Only the closed disclosure states the closed count.
    expect(within(section).getByText("3 closed events")).toBeTruthy();
    expect(within(section).getByRole("heading", { name: "Active events" })).toBeTruthy();
    const activeList = within(section).getByRole("list", { name: "Ana Coordinator active events" });
    expect(within(activeList).getByRole("link", { name: "Active gala" }).getAttribute("href")).toBe(
      "/events/11"
    );
    expect(within(section).getByText("Planning")).toBeTruthy();
    // Completed, rejected and cancelled events stay listed under their own heading.
    expect(within(section).getByRole("heading", { name: "Closed" })).toBeTruthy();
    const closedList = within(section).getByRole("list", { name: "Ana Coordinator closed events" });
    expect(within(closedList).getByRole("link", { name: "Finished fair" })).toBeTruthy();
    expect(within(closedList).getByRole("link", { name: "Turned down" })).toBeTruthy();
    expect(within(closedList).getByRole("link", { name: "Called off" })).toBeTruthy();

    // A Coordinator with no events still appears, so the Lead sees the whole team.
    expect(within(section).getByRole("heading", { name: "Bo Coordinator" })).toBeTruthy();
    expect(within(section).getByText("No events are assigned to this Coordinator.")).toBeTruthy();
  });

  it("ranks Coordinators by active load, then by name", () => {
    const cara: CoordinatorOversight = {
      id: "usr_cara",
      name: "Cara Coordinator",
      email: "cara@example.com",
      events: [
        {
          id: 21,
          eventName: "First gala",
          status: "planning",
          assignedAt: new Date("2026-09-20T02:00:00Z"),
        },
        {
          id: 22,
          eventName: "Second gala",
          status: "submitted",
          assignedAt: new Date("2026-09-21T02:00:00Z"),
        },
      ],
    };
    const zed: CoordinatorOversight = {
      id: "usr_zed",
      name: "Zed Coordinator",
      email: "zed@example.com",
      events: [
        {
          id: 31,
          eventName: "Late gala",
          status: "confirmed",
          assignedAt: new Date("2026-09-22T02:00:00Z"),
        },
      ],
    };
    render(
      <CoordinationPage
        view="lead"
        unassigned={[]}
        assigned={[]}
        oversight={[bo, zed, ana, cara]}
        now={NOW}
      />
    );

    const section = screen.getByRole("region", { name: "Coordinator oversight" });
    const names = within(section)
      .getAllByRole("heading", { level: 3 })
      .map(heading => heading.textContent);
    expect(names).toEqual([
      "Cara Coordinator",
      "Ana Coordinator",
      "Zed Coordinator",
      "Bo Coordinator",
    ]);
  });

  it("holds the closed events in a disclosure that names its count", () => {
    render(
      <CoordinationPage view="lead" unassigned={[]} assigned={[]} oversight={[ana]} now={NOW} />
    );

    const section = screen.getByRole("region", { name: "Coordinator oversight" });
    // jsdom runs the summary activation behavior, so a click opens the disclosure like a browser.
    const summary = within(section).getByText("3 closed events", { selector: "summary" });
    const disclosure = summary.closest("details");
    expect(disclosure).not.toBeNull();
    const details = disclosure as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(within(details).getByRole("link", { name: "Called off" })).toBeTruthy();
  });

  it("keeps the oversight list off the Coordinator view", () => {
    render(
      <CoordinationPage
        view="coordinator"
        unassigned={[]}
        assigned={[]}
        oversight={[ana]}
        now={NOW}
      />
    );

    expect(screen.queryByRole("region", { name: "Coordinator oversight" })).toBeNull();
  });
});

describe("CoordinationPage coordinator view (PTR-15 criterion 5)", () => {
  it("lists the requests assigned to the signed-in Coordinator, and says so when there are none", () => {
    const assignedRow: AssignedEventRequest = {
      ...waiting,
      assignedCoordinatorId: "usr_coord",
      assignedAt: new Date("2026-09-15T03:00:00Z"),
      changeRequestsWaiting: 0,
      venueBlocked: false,
    };
    const { rerender } = render(
      <CoordinationPage
        view="coordinator"
        unassigned={[]}
        assigned={[assignedRow]}
        oversight={[]}
        now={NOW}
      />
    );

    expect(screen.getByRole("link", { name: /Annual dinner/ }).getAttribute("href")).toBe(
      "/events/7"
    );
    expect(screen.getByText(/Jane Doe/)).toBeTruthy();

    // PTR-145: the Coordinator gets no transfer action on the list.
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <CoordinationPage view="coordinator" unassigned={[]} assigned={[]} oversight={[]} now={NOW} />
    );
    expect(screen.getByText("No requests are assigned to you.")).toBeTruthy();
    // The header back link and the empty-state action name the same way out.
    const exits = screen.getAllByRole("link", { name: "Back to dashboard" });
    expect(exits).toHaveLength(2);
    for (const exit of exits) {
      expect(exit.getAttribute("href")).toBe("/dashboard");
    }
  });

  it("shows the decided status next to an assigned request so it does not look actionable", () => {
    const decided: AssignedEventRequest = {
      ...waiting,
      status: "rejected",
      assignedCoordinatorId: "usr_coord",
      assignedAt: new Date("2026-09-15T03:00:00Z"),
      changeRequestsWaiting: 0,
      venueBlocked: false,
    };
    render(
      <CoordinationPage
        view="coordinator"
        unassigned={[]}
        assigned={[decided]}
        oversight={[]}
        now={NOW}
      />
    );

    expect(screen.getByText("Rejected")).toBeTruthy();
  });
});

describe("change requests waiting on the Coordinator (PTR-52 AC1)", () => {
  it("flags each assigned request with how many change requests wait, and nothing when none do", () => {
    const base: AssignedEventRequest = {
      ...waiting,
      assignedCoordinatorId: "usr_coord",
      assignedAt: new Date("2026-09-15T03:00:00Z"),
      changeRequestsWaiting: 0,
      venueBlocked: false,
    };
    render(
      <CoordinationPage
        view="coordinator"
        unassigned={[]}
        assigned={[
          { ...base, id: 1, eventName: "One waiting", changeRequestsWaiting: 1 },
          { ...base, id: 2, eventName: "Two waiting", changeRequestsWaiting: 2 },
          { ...base, id: 3, eventName: "None waiting" },
        ]}
        oversight={[]}
        now={NOW}
      />
    );

    expect(screen.getByText("1 change request waiting")).toBeTruthy();
    expect(screen.getByText("2 change requests waiting")).toBeTruthy();
    expect(screen.getAllByText(/change requests? waiting/)).toHaveLength(2);
  });
});

describe("venue blocks on the Coordinator's list (PTR-137 AC1)", () => {
  it("flags an assigned request whose booking or hold a venue block has suspended", () => {
    const base: AssignedEventRequest = {
      ...waiting,
      assignedCoordinatorId: "usr_coord",
      assignedAt: new Date("2026-09-15T03:00:00Z"),
      changeRequestsWaiting: 0,
      venueBlocked: false,
    };
    render(
      <CoordinationPage
        view="coordinator"
        unassigned={[]}
        assigned={[
          { ...base, id: 1, eventName: "Blocked one", venueBlocked: true },
          { ...base, id: 2, eventName: "Clear one" },
        ]}
        oversight={[]}
        now={NOW}
      />
    );

    expect(screen.getAllByText("Venue blocked")).toHaveLength(1);
  });
});
