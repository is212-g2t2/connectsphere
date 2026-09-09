import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "#/features/auth/components/login-form";

// Mock TanStack Router hooks and components
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn<() => void>(),
}));

// Mock better-auth client
vi.mock("#/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: vi
        .fn<() => Promise<{ data: null; error: null }>>()
        .mockResolvedValue({ data: null, error: null }),
    },
  },
}));

describe("LoginForm component", () => {
  it("renders email and password inputs plus submission controls", () => {
    render(<LoginForm />);

    expect(screen.getByText("Welcome back")).toBeTruthy();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /sign up/i })).toBeTruthy();
  });

  it("shows validation error for invalid email on submit", async () => {
    render(<LoginForm />);

    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: "not-an-email" } });

    const form = emailInput.closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(emailInput.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    });
  });

  it("signs in with email and password", async () => {
    const { authClient } = await import("#/lib/auth-client");
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "test@example.com");
    await user.type(screen.getByLabelText(/password/i), "correct-horse");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(authClient.signIn.email).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "correct-horse",
      });
    });
  });

  it("displays a generic error that hides whether the email exists", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signIn.email).mockResolvedValueOnce({
      data: null,
      error: { message: "User not found", status: 401 } as never,
    });

    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), "unknown@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password.")).toBeTruthy();
    });
    expect(screen.queryByText("User not found")).toBeNull();
  });
});
