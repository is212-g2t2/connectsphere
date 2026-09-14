import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Header } from "#/components/layout/header";
import type { SessionUser } from "#/features/auth/session";

const { useRouteContext } = vi.hoisted(() => ({
  useRouteContext: vi.fn<(opts: { from: string }) => { user: SessionUser | null }>(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouteContext,
}));

// Deliberately without `useSession`: a header that still reached for it would throw on render
// rather than quietly pass, which is the acceptance criterion these tests stand on.
vi.mock("#/lib/auth-client", () => ({
  authClient: { signOut: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
}));

const user: SessionUser = {
  id: "user-1",
  email: "organiser@example.com",
  name: "Organiser",
  image: null,
  role: "event_organiser",
};

/**
 * PTR-73: the nav is a pure function of the session the router already resolved. The component
 * asking Better Auth for it on the client is the regression these assertions stand against —
 * that answer only arrives after hydration, so the header rendered signed-out and then shifted.
 */
describe("Header component", () => {
  it("reads the session from the root route context", () => {
    useRouteContext.mockReturnValue({ user });

    render(<Header />);

    // The root route is the one every page matches, so the nav works outside `_authenticated`.
    expect(useRouteContext).toHaveBeenCalledWith({ from: "__root__" });
  });

  it("renders the signed-in nav on the first render when context carries a user", () => {
    useRouteContext.mockReturnValue({ user });

    render(<Header />);

    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("omits the sign-out control when context carries no user", () => {
    useRouteContext.mockReturnValue({ user: null });

    render(<Header />);

    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});
