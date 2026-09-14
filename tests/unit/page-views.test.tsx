import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingsPage } from "#/features/auth/components/settings-page";
import { DashboardPage } from "#/features/dashboard/components/dashboard-page";
import { VenueDetailPage } from "#/features/venues/components/venue-detail-page";
import { VenueListPage } from "#/features/venues/components/venue-list-page";
import { DEFAULT_OPERATING_HOURS } from "#/features/venues/schema";
import type { SessionUser } from "#/features/auth/session";
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
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ invalidate: vi.fn<() => void>() }),
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: { deleteUser: vi.fn<() => Promise<{ error: null }>>() },
}));

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
    render(<DashboardPage user={userWithRole("attendee")} />);

    expect(screen.getByRole("heading", { name: "Welcome, Casey" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Account settings" })).toBeTruthy();
  });

  it("shows the upload card and the workspace links the role may reach", () => {
    render(<DashboardPage user={userWithRole("venue_staff")} />);

    expect(screen.getByRole("heading", { name: "File upload" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Venues" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
  });

  it("hides every role-gated control from an attendee", () => {
    render(<DashboardPage user={userWithRole("attendee")} />);

    expect(screen.queryByRole("heading", { name: "File upload" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Venues" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
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
});

describe("VenueListPage", () => {
  it("lists the loaded venues with their layouts spelled out", () => {
    render(<VenueListPage user={userWithRole("event_coordinator")} venues={[venue]} />);

    expect(screen.getByRole("link", { name: "Great Hall" })).toBeTruthy();
    expect(screen.getByText("Theatre, Banquet")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "New venue" })).toBeNull();
  });

  it("offers the create link only to a role holding venue:create", () => {
    render(<VenueListPage user={userWithRole("venue_staff")} venues={[]} />);

    expect(screen.getByText("No venues recorded yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "New venue" })).toBeTruthy();
  });
});

describe("VenueDetailPage", () => {
  it("shows the read-only record to a role that may not update it", () => {
    render(
      <VenueDetailPage user={userWithRole("event_coordinator")} venue={venue} justCreated={false} />
    );

    expect(screen.getByRole("heading", { name: "Great Hall" })).toBeTruthy();
    expect(screen.getByText("Level 2, East Wing")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save venue" })).toBeNull();
  });

  it("shows the edit form to Venue Staff, and the banner a fresh record arrives with", () => {
    render(<VenueDetailPage user={userWithRole("venue_staff")} venue={venue} justCreated />);

    expect(screen.getByRole("button", { name: "Save venue" })).toBeTruthy();
    expect(screen.getByText("Venue saved.")).toBeTruthy();
  });
});
