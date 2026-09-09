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
    signUp: {
      email: vi
        .fn<() => Promise<{ data: null; error: null }>>()
        .mockResolvedValue({ data: null, error: null }),
    },
  },
}));

// "Password" and "Confirm password" both match /password/i, so every lookup here is anchored.
const labels = {
  name: /^name$/i,
  email: /^email$/i,
  password: /^password$/i,
  confirmPassword: /^confirm password$/i,
  role: /^role$/i,
};

const VALID = {
  name: "Ada Lovelace",
  email: "newuser@example.com",
  password: "long-enough-pass1!",
};

/**
 * Fills every field with something valid, so a test only has to say what it wants to be wrong.
 * `confirmPassword` follows `password` unless a test overrides it explicitly.
 */
async function fillSignupForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<typeof VALID & { confirmPassword: string }> = {}
): Promise<void> {
  const values = {
    ...VALID,
    confirmPassword: overrides.password ?? VALID.password,
    ...overrides,
  };

  // Sequential on purpose — user-event dispatches real keystrokes, so typing these in parallel
  // would interleave them across fields.
  const type = async (label: RegExp, value: string): Promise<void> => {
    if (value !== "") {
      await user.type(screen.getByLabelText(label), value);
    }
  };

  await type(labels.name, values.name);
  await type(labels.email, values.email);
  await type(labels.password, values.password);
  await type(labels.confirmPassword, values.confirmPassword);
}

describe("SignupForm component", () => {
  it("renders name, email, password, confirm password, role inputs and create account button", () => {
    render(<SignupForm />);

    expect(screen.getByText("Create an account")).toBeTruthy();
    expect(screen.getByLabelText(labels.name)).toBeTruthy();
    expect(screen.getByLabelText(labels.email)).toBeTruthy();
    expect(screen.getByLabelText(labels.password)).toBeTruthy();
    expect(screen.getByLabelText(labels.confirmPassword)).toBeTruthy();
    expect(screen.getByLabelText(labels.role)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeTruthy();
  });

  it("shows validation error when submitting an invalid email", async () => {
    render(<SignupForm />);

    const emailInput = screen.getByLabelText(labels.email);
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

    await fillSignupForm(user, { password: "short" });
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

    await fillSignupForm(user, { password: "alllowercaseletters" });
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Password must contain at least one number")).toBeTruthy();
      expect(screen.getByText("Password must contain at least one symbol")).toBeTruthy();
    });
    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });

  it("rejects a name that is blank or only whitespace", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signUp.email).mockClear();
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user, { name: "   " });
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Enter your name")).toBeTruthy();
    });
    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });

  it("rejects a confirmation that does not match the password", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signUp.email).mockClear();
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user, { confirmPassword: "long-enough-pass2!" });
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Passwords do not match")).toBeTruthy();
    });
    expect(screen.getByLabelText(labels.confirmPassword).getAttribute("aria-invalid")).toBe("true");
    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });

  it("creates an account with a trimmed name and the default attendee role", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signUp.email).mockClear();
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user, { name: "  Ada Lovelace  " });
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authClient.signUp.email).toHaveBeenCalledWith({
        name: "Ada Lovelace",
        email: "newuser@example.com",
        password: "long-enough-pass1!",
        role: "attendee",
      });
    });
  });

  it("creates an account with event_organiser role when selected", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signUp.email).mockClear();
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user, { name: "Grace Hopper", email: "organiser@example.com" });

    await user.click(screen.getByLabelText(labels.role));
    await user.click(await screen.findByRole("option", { name: /event organiser/i }));

    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(authClient.signUp.email).toHaveBeenCalledWith({
        name: "Grace Hopper",
        email: "organiser@example.com",
        password: "long-enough-pass1!",
        role: "event_organiser",
      });
    });
  });

  it("tells the new user to verify their email instead of navigating away", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Check your email")).toBeTruthy();
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

    await fillSignupForm(user, { email: "existing@example.com" });
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Account already exists")).toBeTruthy();
    });
  });
});
