import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "#/features/auth/components/settings-page";
import { DashboardPage } from "#/features/dashboard/components/dashboard-page";
import { DashboardPageSkeleton } from "#/features/dashboard/components/dashboard-page-skeleton";
import { VenueDetailPage } from "#/features/venues/components/venue-detail-page";
import { VenueListPage } from "#/features/venues/components/venue-list-page";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { SessionUser } from "#/features/auth/session";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import type { Venue } from "#/features/venues/server-fns";

/**
 * PTR-75 criterion 4: a page view renders without a router.
 *
 * These pages used to be declared inside their route files, where the only way to reach one was
 * `Route.useRouteContext()` — so rendering the dashboard in a test meant standing up a router,
 * a memory history and a matching route tree first. They now take their route data as props,
 * and the two router hooks the venue page still needs (navigate, invalidate) are mocked at the
 * module, the way `login-form.test.tsx` already mocks them for the forms.
 */
const { routerInvalidate } = vi.hoisted(() => ({
  routerInvalidate: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ invalidate: routerInvalidate }),
}));

const { deleteUser, toast } = vi.hoisted(() => ({
  deleteUser: vi.fn<() => Promise<{ error: { message?: string } | null }>>(),
  toast: { error: vi.fn<(message: string) => void>() },
}));

vi.mock("#/lib/auth-client", () => ({ authClient: { deleteUser } }));

vi.mock("sonner", () => ({ toast }));

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
  facilities: ["Projector"],
  accessibilityFeatures: ["Step-free access"],
  supportedLayouts: ["theatre", "banquet"],
  operatingHours: DEFAULT_OPERATING_HOURS,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

describe("DashboardPage", () => {
  it("greets the session user and links on to their settings", () => {
    render(<DashboardPage user={userWithRole("attendee")} events={[]} />);

    expect(screen.getByRole("heading", { name: "Welcome, Casey" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Account settings" })).toBeTruthy();
  });

  it("shows the upload card and the workspace links the role may reach", () => {
    render(<DashboardPage user={userWithRole("venue_staff")} events={[]} />);

    expect(screen.getByRole("heading", { name: "File upload" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Venues" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Venue calendar" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
  });

  it("hides every role-gated control from an attendee", () => {
    render(<DashboardPage user={userWithRole("attendee")} events={[]} />);

    expect(screen.queryByRole("heading", { name: "File upload" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Venues" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Venue calendar" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
  });

  it("renders the loaded events, redacted to the access they carry", () => {
    render(
      <DashboardPage
        user={userWithRole("venue_staff")}
        events={[
          {
            access: "venue_staff",
            event: {
              id: 7,
              status: "submitted",
              eventDate: "2026-10-01",
              startTime: "09:00",
              endTime: "17:00",
              expectedAttendance: 120,
              layout: "Theatre seating",
              requiredFacilities: "Projector",
              venueRequest: { status: "pending" },
            },
          },
        ]}
      />
    );

    expect(screen.getByText("venue staff access")).toBeTruthy();
    // The venue staff projection carries no name, so the fallback title is what it shows.
    expect(screen.getByRole("heading", { name: "Venue request" })).toBeTruthy();
    expect(screen.getByText("Expected attendance")).toBeTruthy();
    expect(screen.getByText("120")).toBeTruthy();
    // The free-text layout reads back as the layout it names, parsed rather than raw.
    expect(screen.getByText("Theatre")).toBeTruthy();
    expect(screen.getByText("Pending")).toBeTruthy();
    // PTR-36 criterion 4: no overlap, no conflict badge.
    expect(screen.queryByText("Conflicting booking")).toBeNull();
  });

  it("flags a venue request that overlaps an approved booking (PTR-36 AC4)", () => {
    render(
      <DashboardPage
        user={userWithRole("venue_staff")}
        events={[
          {
            access: "venue_staff",
            event: {
              id: 7,
              status: "submitted",
              eventDate: "2026-10-01",
              startTime: "09:00",
              endTime: "17:00",
              venueRequest: { status: "pending", conflict: true },
            },
          },
        ]}
      />
    );

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Conflicting booking")).toBeTruthy();
  });

  it("lets a Coordinator start venue search from an assigned event", () => {
    render(
      <DashboardPage
        user={userWithRole("event_coordinator")}
        events={[
          {
            access: "coordinator",
            event: {
              id: 41,
              status: "submitted",
              name: "Annual summit",
              eventDate: "2026-10-01",
              startTime: "09:00",
              endTime: "17:00",
            },
          },
        ]}
      />
    );

    expect(screen.getByRole("link", { name: "Find venues for this event" })).toBeTruthy();
  });

  it("does not offer the venue search once an event is past finding one (PTR-30)", () => {
    render(
      <DashboardPage
        user={userWithRole("event_coordinator")}
        events={[
          {
            access: "coordinator",
            event: {
              id: 41,
              status: "confirmed",
              name: "Annual summit",
              eventDate: "2026-10-01",
              startTime: "09:00",
              endTime: "17:00",
            },
          },
        ]}
      />
    );

    expect(screen.queryByRole("link", { name: "Find venues for this event" })).toBeNull();
  });

  /**
   * PTR-71: the upload's `status`/`uploadedKey`/`errorMsg` trio is now one action, so a refused
   * presign cannot leave the trigger reading "Uploading…" with a stale key still on screen.
   */
  it("reports a refused upload and leaves the trigger usable", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "Upload refused for this file" }), { status: 400 })
        )
    );
    const { container } = render(<DashboardPage user={userWithRole("venue_staff")} events={[]} />);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    // The type has to satisfy the input's `accept`, or `user.upload` drops the file silently.
    await user.upload(
      input as HTMLInputElement,
      new File(["x"], "notes.txt", { type: "text/plain" })
    );

    expect(await screen.findByText("Upload refused for this file")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Choose file" });
    expect(trigger.hasAttribute("disabled")).toBe(false);
  });

  /** The route's `pendingComponent`: the dashboard's shape while `listEvents` is in flight. */
  it("shows the dashboard's loading shape while the loader is pending", () => {
    const { container } = render(<DashboardPageSkeleton />);

    expect(screen.getByRole("status").textContent).toBe("Loading your dashboard…");
    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
  });
});

describe("SettingsPage", () => {
  it("renders the profile rows and the linked providers from the loader", () => {
    render(
      <SettingsPage
        user={userWithRole("event_organiser")}
        accounts={[{ id: "acct_1", providerId: "credential" }]}
      />
    );

    expect(screen.getByText("casey@example.com")).toBeTruthy();
    expect(screen.getByText("event_organiser")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
  });

  it("renders the empty state, not a loader, when no providers are linked", () => {
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    expect(screen.getByText("No external providers linked.")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("asks for confirmation before deleting the account", async () => {
    const user = userEvent.setup();
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));

    expect(screen.getByRole("button", { name: "Yes, delete my account" })).toBeTruthy();
  });

  /**
   * PTR-71: the deletion used to run as a bare `void handleDeleteAccount()` with nothing tracking
   * it, so both danger-zone buttons stayed live through the most destructive call in the app.
   */
  it("locks the danger zone for as long as the deletion is in flight", async () => {
    const user = userEvent.setup();
    let refuse!: () => void;
    deleteUser.mockReturnValue(
      new Promise(resolve => {
        refuse = () => resolve({ error: { message: "Deletion is disabled" } });
      })
    );
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));

    const confirm = await screen.findByRole("button", { name: "Deleting…" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);

    refuse();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Deletion is disabled"));
  });

  it("surfaces a refused deletion and returns the danger zone to an interactive state", async () => {
    const user = userEvent.setup();
    deleteUser.mockResolvedValue({ error: { message: "Deletion is disabled" } });
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Deletion is disabled"));
    const confirm = screen.getByRole("button", { name: "Yes, delete my account" });
    expect(confirm.hasAttribute("disabled")).toBe(false);
  });
});

describe("VenueListPage", () => {
  it("lists the loaded venues with their layouts spelled out", () => {
    render(
      <VenueListPage
        user={userWithRole("event_coordinator")}
        result={{ event: null, filters: {}, venues: [venue], unsuitable: [] }}
      />
    );

    expect(screen.getByRole("link", { name: "Great Hall" })).toBeTruthy();
    expect(screen.getByText("Theatre, Banquet")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New venue" })).toBeNull();
  });

  it("offers the create link only to a role holding venue:create", () => {
    render(
      <VenueListPage
        user={userWithRole("venue_staff")}
        result={{ event: null, filters: {}, venues: [], unsuitable: [] }}
      />
    );

    expect(screen.getByText("No venues recorded yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New venue" })).toBeTruthy();
  });

  it.each(["venue_staff", "technical_support_staff"])(
    "shows %s the catalogue without the search form or its description",
    role => {
      render(
        <VenueListPage
          user={userWithRole(role)}
          result={{ event: null, filters: {}, venues: [venue], unsuitable: [] }}
        />
      );

      expect(screen.getByRole("region", { name: "Venue results" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Great Hall" })).toBeTruthy();
      expect(
        screen.getByText("ConnectSphere's rooms and spaces, and what each one offers.")
      ).toBeTruthy();
      expect(screen.queryByText("Search venues")).toBeNull();
      expect(
        screen.queryByText("Every result must satisfy every requirement you apply.")
      ).toBeNull();
      expect(
        screen.queryByText(
          "Search ConnectSphere's rooms and spaces against an event's hard requirements."
        )
      ).toBeNull();
    }
  );
});

describe("VenueDetailPage", () => {
  it("shows the read-only record to a role that may not update it", () => {
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
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
        justCreated
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.getByRole("button", { name: "Save venue" })).toBeTruthy();
    expect(screen.getByText("Venue saved.")).toBeTruthy();
  });

  it("points a Coordinator without an event context at their dashboard", () => {
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.getByRole("link", { name: "dashboard" })).toBeTruthy();
    expect(screen.getByText(/use Find venues for this event/)).toBeTruthy();
  });

  it("reports a failed request-context load and retries it instead of sending the Coordinator back", async () => {
    const user = userEvent.setup();
    render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
        justCreated={false}
        requestContext={null}
        requestContextFailed
      />
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load this venue's request panel."
    );
    // The dead-end search hint belongs to "no event", not to a transient failure.
    expect(screen.queryByRole("link", { name: "dashboard" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(routerInvalidate).toHaveBeenCalled();
  });

  it("does not offer the request hint to a role without venue_request:request", () => {
    render(
      <VenueDetailPage
        user={userWithRole("venue_staff")}
        venue={venue}
        justCreated={false}
        requestContext={null}
        requestContextFailed={false}
      />
    );

    expect(screen.queryByText(/use Find venues for this event/)).toBeNull();
  });

  /**
   * PTR-31: a successful send or withdraw swaps the panel's branch under the same heading, so
   * focus would otherwise fall to `<body>` and the new state go unannounced. The panel watches its
   * own event/venue/request identity and moves focus only when a request changes within the same
   * context, never on the first paint.
   */
  it("focuses the panel heading when the request changes, but not on first paint", () => {
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
      request: null,
    };
    const { rerender } = render(
      <VenueDetailPage
        user={userWithRole("event_coordinator")}
        venue={venue}
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
        justCreated={false}
        requestContext={{
          ...openContext,
          request: {
            id: "req-1",
            startsAt: "2026-10-12T14:30",
            endsAt: "2026-10-12T18:45",
            canWithdraw: true,
          },
        }}
        requestContextFailed={false}
      />
    );

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Venue request" }));
  });
});
