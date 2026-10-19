// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "#/components/layout/header";
import type { SessionUser } from "#/features/auth/session";

const { useRouteContext, useLocation } = vi.hoisted(() => ({
  useRouteContext:
    vi.fn<(opts: { from: string }) => { user: SessionUser | null; unreadNotifications: number }>(),
  useLocation: vi.fn<() => { pathname: string }>(() => ({ pathname: "/" })),
}));

const { signOut, toast } = vi.hoisted(() => ({
  signOut: vi.fn<() => Promise<{ error: { message?: string } | null }>>(),
  toast: { error: vi.fn<(message: string) => void>() },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    "aria-label"?: string;
    "aria-current"?: "page" | undefined;
    title?: string;
    className?: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouteContext,
  useLocation,
}));

// Omit `useSession` on purpose. A header that still reaches for it throws on render. It never
// quietly passes. That throw is the acceptance criterion.
vi.mock("#/lib/auth-client", () => ({ authClient: { signOut } }));

vi.mock("sonner", () => ({ toast }));

const user: SessionUser = {
  id: "user-1",
  email: "organiser@example.com",
  name: "Organiser Person",
  image: null,
  role: "event_organiser",
};

beforeEach(() => {
  vi.clearAllMocks();
  useRouteContext.mockReturnValue({ user, unreadNotifications: 0 });
  useLocation.mockReturnValue({ pathname: "/" });
});

async function openAccountMenu(visitor: ReturnType<typeof userEvent.setup>) {
  await visitor.click(screen.getByRole("button", { name: "Account menu" }));
  // The menu popup mounts asynchronously for floating-ui positioning. Wait for it.
  await screen.findByRole("menuitem", { name: "Sign out" });
  return visitor;
}

/** PTR-73: the nav is a pure function of the session the router already resolved. These
 * assertions stand against the regression where the component asks Better Auth on the client.
 * That answer arrives only after hydration. The header rendered signed-out, then shifted.
 */
describe("Header component", () => {
  it("reads the session from the root route context", () => {
    useRouteContext.mockReturnValue({ user, unreadNotifications: 0 });

    render(<Header />);

    // Every page matches the root route. The nav works outside `_authenticated`.
    expect(useRouteContext).toHaveBeenCalledWith({ from: "__root__" });
  });

  it("renders the signed-in nav on the first render when context carries a user", async () => {
    useRouteContext.mockReturnValue({ user, unreadNotifications: 0 });
    const visitor = userEvent.setup();

    const { container } = render(<Header />);

    expect(screen.getByRole("link", { name: "Notifications" })).toBeTruthy();
    expect(container.querySelector(".lucide-bell")).toBeTruthy();
    expect(container.querySelector(".lucide-bell-dot")).toBeNull();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
    expect(screen.getByText("OP")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();

    await openAccountMenu(visitor);
    expect(screen.getByRole("menuitem", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("marks the bell unread when the context carries unread notifications", () => {
    useRouteContext.mockReturnValue({ user, unreadNotifications: 2 });

    const { container } = render(<Header />);

    expect(screen.getByRole("link", { name: "Notifications, unread" })).toBeTruthy();
    expect(container.querySelector(".lucide-bell-dot")).toBeTruthy();
  });

  it("falls back to the email initial when the user has no name", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, name: null },
      unreadNotifications: 0,
    });

    render(<Header />);

    expect(screen.getByText("O")).toBeTruthy();
  });

  it("omits the signed-in controls when context carries no user", () => {
    useRouteContext.mockReturnValue({ user: null, unreadNotifications: 0 });

    render(<Header />);

    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Notifications" })).toBeNull();
  });

  it("renders no section links for an attendee", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, role: "attendee" },
      unreadNotifications: 0,
    });

    render(<Header />);

    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
  });

  it("keeps the role nav scrollable on narrow screens", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, role: "event_coordinator" },
      unreadNotifications: 0,
    });

    render(<Header />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.getAttribute("class")).not.toContain("hidden");
    expect(nav.getAttribute("class")).toContain("overflow-x-auto");
  });

  it("marks the link matching the current location", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, role: "event_coordinator" },
      unreadNotifications: 0,
    });
    useLocation.mockReturnValue({ pathname: "/coordination" });

    render(<Header />);

    expect(screen.getByRole("link", { name: "Coordination" }).getAttribute("aria-current")).toBe(
      "page"
    );
    expect(screen.getByRole("link", { name: "Venues" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("Header role links", () => {
  it("renders Event requests for an event organiser", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, role: "event_organiser" },
      unreadNotifications: 0,
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: "Event requests" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Coordination" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Venues" })).toBeNull();
  });

  it("renders Coordination, Venues, and Venue calendar for an event coordinator", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, role: "event_coordinator" },
      unreadNotifications: 0,
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: "Coordination" }).getAttribute("href")).toBe(
      "/coordination"
    );
    expect(screen.getByRole("link", { name: "Venues" }).getAttribute("href")).toBe("/venues");
    expect(screen.getByRole("link", { name: "Venue calendar" }).getAttribute("href")).toBe(
      "/venues/availability"
    );
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Approved bookings" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Hold requests" })).toBeNull();
  });

  it("renders only Coordination for an event coordinator lead", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, role: "event_coordinator_lead" },
      unreadNotifications: 0,
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: "Coordination" }).getAttribute("href")).toBe(
      "/coordination"
    );
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Venues" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Venue calendar" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Approved bookings" })).toBeNull();
  });

  it("renders Venues, Venue calendar, Approved bookings and Hold requests for venue staff", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, role: "venue_staff" },
      unreadNotifications: 0,
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: "Venues" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Venue calendar" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Approved bookings" }).getAttribute("href")).toBe(
      "/venue-bookings"
    );
    // PTR-150 AC2: the shared hold-request queue.
    expect(screen.getByRole("link", { name: "Hold requests" }).getAttribute("href")).toBe(
      "/venue-holds"
    );
    expect(screen.queryByRole("link", { name: "Coordination" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
  });

  it("renders Venues and Venue calendar for technical support staff", () => {
    useRouteContext.mockReturnValue({
      user: { ...user, role: "technical_support_staff" },
      unreadNotifications: 0,
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: "Venues" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Venue calendar" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Approved bookings" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Hold requests" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Coordination" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Event requests" })).toBeNull();
  });
});

/** PTR-71: signing out is a mutation with React holding its in-flight flag. A refused sign-out
 * lands in the action's error state and never leaves the nav on a still-open session. While the
 * run is in flight the menu item stays disabled, then clears on settle.
 */
describe("Header sign-out", () => {
  it("signs out from the account menu", async () => {
    const visitor = userEvent.setup();
    signOut.mockResolvedValue({ error: null });

    render(<Header />);
    await openAccountMenu(visitor);
    await visitor.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("surfaces a refused sign-out", async () => {
    const visitor = userEvent.setup();
    signOut.mockResolvedValue({ error: { message: "Session already ended" } });

    render(<Header />);
    await openAccountMenu(visitor);
    await visitor.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Session already ended"));
  });

  it("disables the Sign out item while the run is in flight, then clears it", async () => {
    const visitor = userEvent.setup();
    let resolveSignOut!: (value: { error: null }) => void;
    signOut.mockReturnValue(
      new Promise(resolve => {
        resolveSignOut = resolve;
      })
    );

    render(<Header />);
    await openAccountMenu(visitor);
    await visitor.click(screen.getByRole("menuitem", { name: "Sign out" }));

    // The menu closes on click. Reopen it while the promise is still pending.
    await openAccountMenu(visitor);
    const item = screen.getByRole("menuitem", { name: "Sign out" });
    expect(item.getAttribute("aria-disabled")).toBe("true");

    resolveSignOut({ error: null });
    await waitFor(() => expect(item.getAttribute("aria-disabled")).toBeNull());
  });
});
