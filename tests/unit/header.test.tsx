import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "#/components/layout/header";
import type { SessionUser } from "#/features/auth/session";

const { useRouteContext } = vi.hoisted(() => ({
  useRouteContext: vi.fn<(opts: { from: string }) => { user: SessionUser | null }>(),
}));

const { signOut, toast } = vi.hoisted(() => ({
  signOut: vi.fn<() => Promise<{ error: { message?: string } | null }>>(),
  toast: { error: vi.fn<(message: string) => void>() },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
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
  name: "Organiser",
  image: null,
  role: "event_organiser",
};

beforeEach(() => {
  vi.clearAllMocks();
  useRouteContext.mockReturnValue({ user });
});

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

/**
 * PTR-71: signing out is a mutation, so React holds its in-flight flag. The `signingOut` boolean
 * it replaces was set before the call and cleared after it — but only on the path that returned,
 * so a refused sign-out left the button disabled for good with nothing on screen to say why.
 */
describe("Header sign-out", () => {
  it("disables the control for as long as the sign-out is in flight", async () => {
    const visitor = userEvent.setup();
    let complete!: () => void;
    signOut.mockReturnValue(
      new Promise(resolve => {
        complete = () => resolve({ error: null });
      })
    );

    render(<Header />);
    await visitor.click(screen.getByRole("button", { name: "Sign out" }));

    const button = await screen.findByRole("button", { name: "Signing out…" });
    expect(button.hasAttribute("disabled")).toBe(true);

    complete();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy());
  });

  it("surfaces a refused sign-out and leaves the control usable", async () => {
    const visitor = userEvent.setup();
    signOut.mockResolvedValue({ error: { message: "Session already ended" } });

    render(<Header />);
    await visitor.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Session already ended"));
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});
