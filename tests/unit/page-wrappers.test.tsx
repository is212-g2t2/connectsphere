// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoginPage } from "#/features/auth/components/login-page";
import { ResetPasswordPage } from "#/features/auth/components/reset-password-page";
import { SignupPage } from "#/features/auth/components/signup-page";
import { LandingPage } from "#/features/landing/components/landing-page";

/** PTR-75 page wrappers take no route data. Each places a feature component on the shared shell.
 * These tests check the layout and route props. They catch a wrapper that drops the card or stops
 * passing `token` or `error`. The form tests cannot catch that breakage.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ invalidate: vi.fn<() => Promise<void>>() }),
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn<() => Promise<{ data: null; error: null }>>() },
    signUp: { email: vi.fn<() => Promise<{ data: null; error: null }>>() },
    sendVerificationEmail: vi.fn<() => Promise<{ data: null; error: null }>>(),
    requestPasswordReset: vi.fn<() => Promise<{ data: null; error: null }>>(),
    resetPassword: vi.fn<() => Promise<{ data: null; error: null }>>(),
  },
}));

function authCard(container: HTMLElement): Element | null {
  return container.querySelector('[data-slot="card"][data-size="auth"]');
}

describe("LoginPage", () => {
  it("places the sign-in form on the 880px column in the auth card", () => {
    const { container } = render(<LoginPage />);

    expect(container.querySelector("main")?.className).toContain("max-w-page");
    expect(authCard(container)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
  });

  it("wraps the card in the shared auth shell trust chrome", () => {
    const { container } = render(<LoginPage />);

    expect(container.querySelector('[aria-label="ConnectSphere home"]')).not.toBeNull();
    expect(screen.getByText(/contact your administrator/i)).toBeTruthy();
    // No Terms or Privacy Policy page exists, so the shell must not promise one.
    expect(screen.queryByText(/terms/i)).toBeNull();
    expect(screen.queryByText(/privacy/i)).toBeNull();
  });
});

describe("SignupPage", () => {
  it("places the registration form on the 880px column in the auth card", () => {
    const { container } = render(<SignupPage />);

    expect(container.querySelector("main")?.className).toContain("max-w-page");
    expect(authCard(container)).not.toBeNull();
    expect(screen.getByText("Create an account")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /attendee/i })).toBeTruthy();
    expect(screen.getByText(/You cannot change this later/)).toBeTruthy();
  });
});

describe("ResetPasswordPage", () => {
  it("asks for a link when the route carried no token", () => {
    const { container } = render(<ResetPasswordPage />);

    expect(authCard(container)).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
  });

  it("explains an expired link when the route carried an error", () => {
    render(<ResetPasswordPage error="INVALID_TOKEN" />);

    expect(screen.getByText(/invalid or has expired/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
  });

  it("forwards the token into the set-a-new-password state", () => {
    render(<ResetPasswordPage token="tok-123" />);

    expect(screen.getByRole("heading", { name: "Set a new password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save password" })).toBeTruthy();
  });
});

describe("LandingPage", () => {
  it("renders the outcome headline and keeps the SEO description", () => {
    const { container } = render(<LandingPage />);

    expect(container.querySelector("main")?.className).toContain("max-w-page");
    expect(
      screen.getByRole("heading", { level: 1, name: /plan events and book venues/i })
    ).toBeTruthy();
    expect(screen.getByText(/Event planning and venue booking/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create an account" }).getAttribute("href")).toBe(
      "/signup"
    );
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  });

  it("names the self-assignable roles and says staff accounts are provisioned", () => {
    render(<LandingPage />);

    expect(screen.getByText(/attendee or an event organiser/i)).toBeTruthy();
    expect(screen.getByText(/provisioned by an administrator/i)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Request an event" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Find a venue" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Stay coordinated" })).toBeTruthy();
  });
});
