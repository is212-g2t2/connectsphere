// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardPage } from "#/features/dashboard/components/dashboard-page";
import { DashboardPageSkeleton } from "#/features/dashboard/components/dashboard-page-skeleton";
import type { DashboardData } from "#/features/dashboard/dashboard-view";
import type { EventProjection } from "#/features/events/access";

/** PTR-75 criterion 4: page views must render without a router. */
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
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
}));
vi.mock("#/features/events/server-fns", () => ({
  withdrawFromEvent: vi.fn<() => Promise<unknown>>(),
}));

function organiserEvent(
  id: number,
  event: Partial<EventProjection["event"]> = {}
): EventProjection {
  return {
    access: "organiser",
    event: {
      id,
      name: `Event ${id}`,
      description: `Description ${id}.`,
      status: "submitted",
      eventDate: "2026-10-01",
      startTime: "09:00",
      endTime: "17:00",
      ...event,
    },
  };
}

function data(
  role: DashboardData["role"],
  events: EventProjection[],
  extra: Partial<DashboardData> = {}
): DashboardData {
  return { role, events, ...extra };
}

describe("DashboardPage", () => {
  it("heads the page with the role title, description, and primary action, without an eyebrow", () => {
    render(
      <DashboardPage
        data={data("event_organiser", [organiserEvent(7)], {
          drafts: [{ status: "draft" }, { status: "draft" }] as DashboardData["drafts"],
        })}
      />
    );

    expect(screen.getByRole("heading", { name: "Your events" })).toBeTruthy();
    expect(screen.getByText("Requests you made and their progress.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New request" }).getAttribute("href")).toBe(
      "/event-requests/new"
    );
    // The access eyebrow is gone: the scoped status pills name each row's entity instead.
    expect(screen.queryByText("organiser access")).toBeNull();
  });

  it("shows each queue with its count and the event count", () => {
    render(
      <DashboardPage
        data={data("event_organiser", [organiserEvent(7, { status: "awaiting_organiser" })], {
          drafts: [{ status: "draft" }, { status: "draft" }] as DashboardData["drafts"],
        })}
      />
    );

    const queues = screen.getByRole("list", { name: "Queues" });
    expect(within(queues).getByRole("link", { name: "Drafts (2)" }).getAttribute("href")).toBe(
      "/event-requests"
    );
    expect(screen.getByText("1 event · 1 needs attention")).toBeTruthy();
  });

  it("marks the safety officer's reviewed event as needing attention", () => {
    render(
      <DashboardPage
        data={data(
          "safety_officer",
          [
            {
              access: "safety_officer",
              event: {
                id: 7,
                name: "Event 7",
                description: "Description 7.",
                status: "approved",
                eventDate: "2026-10-01",
                startTime: "09:00",
                endTime: "17:00",
              },
            },
          ],
          {
            safetyReviews: [
              {
                updated: false,
                id: 3,
                eventId: 7,
                eventName: "Event 7",
                eventStatus: "approved",
                venue: null,
                createdAt: "2026-09-15T02:00:00Z",
                current: true,
              },
            ],
          }
        )}
      />
    );

    expect(screen.getByText("1 event · 1 needs attention")).toBeTruthy();
  });

  it("sorts actionable rows first and scopes each status pill by entity", () => {
    render(
      <DashboardPage
        data={data("event_organiser", [
          organiserEvent(7, { status: "approved", name: "Settled gala" }),
          organiserEvent(12, { status: "awaiting_organiser", name: "Waiting dinner" }),
        ])}
      />
    );

    const rows = within(screen.getByRole("list", { name: "Events" })).getAllByRole("link");
    expect(rows.map(row => row.textContent)).toEqual(["Waiting dinner", "Settled gala"]);
    expect(screen.getByText("Event: Awaiting organiser")).toBeTruthy();
    expect(screen.getByText("Event: Approved")).toBeTruthy();
  });

  it("gives a registered attendee on a non-confirmed event a withdraw action, not a dead card", () => {
    render(
      <DashboardPage
        data={data("attendee", [
          {
            access: "attendee",
            event: {
              id: 12,
              name: "Open Day",
              status: "under_review",
              registrationEnabled: true,
              eventDate: "2026-12-05",
              startTime: "10:00",
              endTime: "15:00",
              registration: { status: "registered", registeredAt: "2026-11-02T03:04:05.000Z" },
              venue: null,
            },
          },
        ])}
      />
    );

    expect(screen.getByText("Open Day")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open Day" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw registration" })).toBeTruthy();
  });

  it("shows the role-aware empty state with an action when no events are connected", () => {
    render(<DashboardPage data={data("event_organiser", [], { drafts: [] })} />);

    expect(screen.getByText("No events yet")).toBeTruthy();
    expect(screen.getByText("Start your first request to see it here.")).toBeTruthy();
    // The header action and the empty-state action name the same next step.
    const actions = screen.getAllByRole("link", { name: "New request" });
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      expect(action.getAttribute("href")).toBe("/event-requests/new");
    }
  });

  it("leaves the attendee empty state without a staff action", () => {
    render(<DashboardPage data={data("attendee", [])} />);

    expect(screen.getByText("No events yet")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  /** Dashboard shape while the route's reads are pending. */
  it("shows the dashboard's loading shape while the loader is pending", () => {
    const { container } = render(<DashboardPageSkeleton />);

    expect(screen.getByRole("status").textContent).toBe("Loading your dashboard…");
    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector("dl")).toBeNull();
  });
});
