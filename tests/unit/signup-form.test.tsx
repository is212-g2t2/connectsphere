import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SignupForm } from "#/features/auth/components/signup-form";

const mockNavigate = vi.fn<() => void>();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: {
    signIn: {
      social: vi
        .fn<() => Promise<{ data: null; error: null }>>()
        .mockResolvedValue({ data: null, error: null }),
    },
    signUp: {
      email: vi
        .fn<() => Promise<{ data: null; error: null }>>()
        .mockResolvedValue({ data: null, error: null }),
    },
    emailOtp: {
      sendVerificationOtp: vi
        .fn<() => Promise<{ data: null; error: null }>>()
        .mockResolvedValue({ data: null, error: null }),
    },
  },
}));

describe("SignupForm component", () => {
  it("renders email and password inputs, create account button, and Google OAuth button", () => {
    render(<SignupForm />);

    expect(screen.getByText("Create an account")).toBeTruthy();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign up with an email code/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
  });

  it("shows validation error when submitting an invalid email", async () => {
    render(<SignupForm />);

    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: "invalid-email" } });

    const form = emailInput.closest("form");
    expect(form).toBeTruthy();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(emailInput.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    });
  });

  it("rejects a password shorter than 8 characters", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signUp.email).mockClear();
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "newuser@example.com");
    await user.type(screen.getByLabelText(/password/i), "short");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Password must be at least 8 characters")).toBeTruthy();
    });
    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });

  it("rejects a long password with no number or symbol", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signUp.email).mockClear();
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "newuser@example.com");
    await user.type(screen.getByLabelText(/password/i), "alllowercaseletters");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Password must contain at least one number")).toBeTruthy();
      expect(screen.getByText("Password must contain at least one symbol")).toBeTruthy();
    });
    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });

  it("creates an account with email and password", async () => {
    const { authClient } = await import("#/lib/auth-client");
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "newuser@example.com");
    await user.type(screen.getByLabelText(/password/i), "long-enough-pass1!");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authClient.signUp.email).toHaveBeenCalledWith({
        name: "",
        email: "newuser@example.com",
        password: "long-enough-pass1!",
      });
    });
  });

  it("tells the new user to verify their email instead of navigating away", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "newuser@example.com");
    await user.type(screen.getByLabelText(/password/i), "long-enough-pass1!");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Check your email")).toBeTruthy();
      expect(
        screen.getByText(/signing in with an email code before you verify clears it/i)
      ).toBeTruthy();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("displays server error message when sign-up fails", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signUp.email).mockResolvedValueOnce({
      data: null,
      error: { message: "Account already exists", status: 400, statusText: "Bad Request" } as never,
    });

    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "existing@example.com");
    await user.type(screen.getByLabelText(/password/i), "long-enough-pass1!");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Account already exists")).toBeTruthy();
    });
  });

  it("sends an OTP and navigates to verify-otp when signing up with a code", async () => {
    const { authClient } = await import("#/lib/auth-client");
    const user = userEvent.setup();
    render(<SignupForm />);

    await user.type(screen.getByLabelText(/email/i), "newuser@example.com");
    await user.click(screen.getByRole("button", { name: /sign up with an email code/i }));

    await waitFor(() => {
      expect(authClient.emailOtp.sendVerificationOtp).toHaveBeenCalledWith({
        email: "newuser@example.com",
        type: "sign-in",
      });
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/verify-otp",
        search: { email: "newuser@example.com", flow: "sign-up" },
      });
    });
  });

  it("triggers Google social sign-in when clicking Continue with Google", async () => {
    const { authClient } = await import("#/lib/auth-client");
    const user = userEvent.setup();
    render(<SignupForm />);

    const googleButton = screen.getByRole("button", { name: /continue with google/i });
    await user.click(googleButton);

    await waitFor(() => {
      expect(authClient.signIn.social).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/",
      });
    });
  });
});
