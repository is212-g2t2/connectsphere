// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SignupForm } from "#/features/auth/components/signup-form";

const mockNavigate = vi.fn<() => void>();
// PTR-73: Sign-up updates the route context, so the form resolves the header's user again.
const mockInvalidate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
  useRouter: () => ({ invalidate: mockInvalidate }),
}));

vi.mock("#/lib/auth-client", () => ({
  authClient: {
    signUp: {
      email: vi
        .fn<() => Promise<{ data: null; error: null }>>()
        .mockResolvedValue({ data: null, error: null }),
    },
    sendVerificationEmail: vi
      .fn<() => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null }),
  },
}));

// The password and confirm-password labels share text, so the password query stays exact and the
// confirm query uses its own label.
const labels = {
  name: /^name$/i,
  email: /^email$/i,
  password: /^password$/i,
  confirmPassword: /^confirm password$/i,
};

const VALID = {
  name: "Ada Lovelace",
  email: "newuser@example.com",
  password: "long-enough-pass1!",
};

type RoleChoice = "attendee" | "event_organiser" | null;

/** Fill every field with valid data. A test only sets the value it wants to make invalid.
 * `confirmPassword` matches `password` unless a test overrides it. Pass `role: null` to leave the
 * choice empty.
 */
async function fillSignupForm(
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<typeof VALID & { confirmPassword: string }> & { role?: RoleChoice } = {}
): Promise<void> {
  const { role = "attendee", ...rest } = overrides;
  const values = {
    ...VALID,
    confirmPassword: rest.password ?? VALID.password,
    ...rest,
  };

  // Type in order because user-event dispatches real keystrokes. Parallel typing would interleave
  // the fields.
  const type = async (label: RegExp, value: string): Promise<void> => {
    if (value !== "") {
      await user.type(screen.getByLabelText(label), value);
    }
  };

  await type(labels.name, values.name);
  await type(labels.email, values.email);
  await type(labels.password, values.password);
  await type(labels.confirmPassword, values.confirmPassword);
  if (role) {
    await user.click(
      screen.getByRole("radio", { name: new RegExp(role.replaceAll("_", " "), "i") })
    );
  }
}

describe("SignupForm component", () => {
  it("renders name, email, password, confirm password, role choices and create account button", () => {
    render(<SignupForm />);

    expect(screen.getByText("Create an account")).toBeTruthy();
    expect(screen.getByLabelText(labels.name)).toBeTruthy();
    expect(screen.getByLabelText(labels.email)).toBeTruthy();
    expect(screen.getByLabelText(labels.password)).toBeTruthy();
    expect(screen.getByLabelText(labels.confirmPassword)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /attendee/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /event organiser/i })).toBeTruthy();
    expect(screen.getByText(/You cannot change this later/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeTruthy();
  });

  it("requires an explicit role choice instead of defaulting to attendee", async () => {
    const { authClient } = await import("#/lib/auth-client");
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user, { role: null });
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText("Choose a role")).toBeTruthy();
    });
    expect(authClient.signUp.email).not.toHaveBeenCalled();
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

  it("reveals both passwords without submitting the form", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    expect(screen.getByLabelText(labels.password).getAttribute("type")).toBe("password");
    const toggles = screen.getAllByRole("button", { name: /show password/i });
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) {
      expect(toggle.getAttribute("type")).toBe("button");
    }

    await user.click(toggles[0]);

    expect(screen.getByLabelText(labels.password).getAttribute("type")).toBe("text");
    expect(screen.getByLabelText(labels.confirmPassword).getAttribute("type")).toBe("password");
  });

  it("creates an account with a trimmed name and the chosen attendee role", async () => {
    const { authClient } = await import("#/lib/auth-client");
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
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user, {
      name: "Grace Hopper",
      email: "organiser@example.com",
      role: "event_organiser",
    });

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

    // The page stays in place, and nothing else resolves the header's route context again (PTR-73).
    // Without this step, the navigation still shows the user as signed out.
    await waitFor(() => {
      expect(mockInvalidate).toHaveBeenCalled();
    });
  });

  it("resends the verification email from the verification panel", async () => {
    const { authClient } = await import("#/lib/auth-client");
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByText("Check your email");
    await user.click(screen.getByRole("button", { name: /resend verification email/i }));

    await waitFor(() => {
      expect(authClient.sendVerificationEmail).toHaveBeenCalledWith({
        email: "newuser@example.com",
      });
      expect(screen.getByText(/check your inbox/i)).toBeTruthy();
    });
  });

  it("navigates to the dashboard when continuing from the verification screen", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await screen.findByText("Check your email");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/dashboard" });
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

  it("replaces a previous refusal rather than stacking a second one beside it", async () => {
    const { authClient } = await import("#/lib/auth-client");
    vi.mocked(authClient.signUp.email)
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Account already exists", status: 400 } as never,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Registration is closed", status: 403 } as never,
      });

    const user = userEvent.setup();
    render(<SignupForm />);

    await fillSignupForm(user, { email: "existing@example.com" });
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Account already exists");
    });

    // Resubmitting validates again and updates `errorMap.onSubmit`, which removes the first message.
    // The form has no separate error state to reset.
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Registration is closed");
    });
    expect(screen.queryByText("Account already exists")).toBeNull();
  });
});
