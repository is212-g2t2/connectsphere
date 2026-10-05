import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "#/components/layout/header";
import type { SessionUser } from "#/features/auth/session";

const { useRouteContext } = vi.hoisted(() => ({
  useRouteContext:
    vi.fn<(opts: { from: string }) => { user: SessionUser | null; unreadNotifications: number }>(),
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
    title?: string;
    className?: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useRouteContext,
}));

// Deliberately without `useSession`: a header that still reached for it would throw on render
// rather than quietly pass, which is the acceptance criterion these tests stand on.
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
});

async function openAccountMenu(visitor: ReturnType<typeof userEvent.setup>) {
  await visitor.click(screen.getByRole("button", { name: "Account menu" }));
  // The menu popup mounts asynchronously (floating-ui positioning), so wait for it.
  await screen.findByRole("menuitem", { name: "Sign out" });
  return visitor;
}

/**
 * PTR-73: the nav is a pure function of the session the router already resolved. The component
 * asking Better Auth for it on the client is the regression these assertions stand against —
 * that answer only arrives after hydration, so the header rendered signed-out and then shifted.
 */
describe("Header component", () => {
  it("reads the session from the root route context", () => {
    useRouteContext.mockReturnValue({ user, unreadNotifications: 0 });

    render(<Header />);

    // The root route is the one every page matches, so the nav works outside `_authenticated`.
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
});

/**
 * PTR-71: signing out is a mutation, so React holds its in-flight flag. A refused sign-out lands
 * in the action's error state rather than leaving the nav pointing at a session that is still
 * open — and the menu closes on click, so there is no in-flight button to assert on.
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
});
