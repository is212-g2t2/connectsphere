// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "#/features/auth/components/settings-page";
import type { SessionUser } from "#/features/auth/session";

const { deleteUser, updateUser, changePassword, invalidate, toast } = vi.hoisted(() => ({
  deleteUser: vi.fn<() => Promise<{ error: { message?: string } | null }>>(),
  updateUser: vi.fn<() => Promise<{ error: { message?: string } | null }>>(),
  changePassword: vi.fn<() => Promise<{ error: { message?: string } | null }>>(),
  invalidate: vi.fn<() => Promise<void>>(),
  toast: {
    error: vi.fn<(message: string) => void>(),
    success: vi.fn<(message: string) => void>(),
  },
}));

vi.mock("#/lib/auth-client", () => ({ authClient: { deleteUser, updateUser, changePassword } }));

vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate }) }));

vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  vi.clearAllMocks();
  invalidate.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function userWithRole(role: string): SessionUser {
  return { id: "usr_1", email: "casey@example.com", name: "Casey", role };
}

async function fillPasswordForm(
  user: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string
) {
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), next);
}

describe("SettingsPage", () => {
  it("renders the profile rows with the role label and the sign-in providers from the loader", () => {
    render(
      <SettingsPage
        user={userWithRole("event_organiser")}
        accounts={[{ id: "acct_1", providerId: "credential" }]}
      />
    );

    expect(screen.getByText("casey@example.com")).toBeTruthy();
    expect(screen.getByText("Event organiser")).toBeTruthy();
    expect(screen.queryByText("event_organiser")).toBeNull();
    expect(screen.getByText("Sign-in")).toBeTruthy();
    expect(screen.queryByText("Linked providers")).toBeNull();
    expect(screen.getByText("Password")).toBeTruthy();
    // The role stays read-only: an administrator creates staff accounts.
    expect(screen.getByText(/Staff accounts are created by an administrator/)).toBeTruthy();
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

  /** PTR-71: `handleDeleteAccount()` ran without tracked state. Both danger-zone buttons stayed
   * active while the account deletion was in progress.
   */
  it("locks the danger zone for as long as the deletion is in flight", async () => {
    const user = userEvent.setup();
    let refuse!: () => void;
    deleteUser.mockReturnValue(
      new Promise(resolve => {
        refuse = () => resolve({ error: { message: "Deletion is disabled" } });
      })
    );
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));

    const confirm = await screen.findByRole("button", { name: "Deleting…" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);

    refuse();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Deletion is disabled"));
  });

  it("surfaces a refused deletion and returns the danger zone to an interactive state", async () => {
    const user = userEvent.setup();
    deleteUser.mockResolvedValue({ error: { message: "Deletion is disabled" } });
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await user.click(screen.getByRole("button", { name: "Yes, delete my account" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Deletion is disabled"));
    const confirm = await screen.findByRole("button", { name: "Yes, delete my account" });
    expect(confirm.hasAttribute("disabled")).toBe(false);
  });
});

describe("SettingsPage profile name", () => {
  it("requires a name before calling updateUser", async () => {
    const user = userEvent.setup();
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByText("Enter your name")).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("saves the trimmed name, toasts, and re-reads the session on success", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue({ error: null });
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "  New Name  ");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ name: "New Name" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Profile updated."));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("toasts the server refusal without re-reading the session", async () => {
    const user = userEvent.setup();
    updateUser.mockResolvedValue({ error: { message: "Name is taken" } });
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.type(screen.getByLabelText("Name"), " Taken");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Name is taken"));
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("SettingsPage password change", () => {
  it("uses PasswordInput fields with the live rules on the new password only", async () => {
    const user = userEvent.setup();
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    // Each password field offers a reveal button, like sign-up and reset.
    expect(screen.getAllByRole("button", { name: "Show password" })).toHaveLength(3);
    expect(screen.getByRole("list", { name: "Password rules" })).toBeTruthy();

    // The rules track the new password, not the other fields.
    await user.type(screen.getByLabelText("New password"), "brand-new-1!");
    const rules = screen.getByRole("list", { name: "Password rules" });
    expect(rules.textContent).toContain("✓");
  });

  it("requires the current password and matching confirmation", async () => {
    const user = userEvent.setup();
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await user.type(screen.getByLabelText("New password"), "new-pass-1!");
    await user.type(screen.getByLabelText("Confirm new password"), "other-pass-1!");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(screen.getByText("Enter your current password")).toBeTruthy();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("enforces the shared password policy on the new password", async () => {
    const user = userEvent.setup();
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await fillPasswordForm(user, "current-pass-1!", "short");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(screen.getByText("Password must be at least 8 characters")).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("changes the password, toasts, and re-reads the session on success", async () => {
    const user = userEvent.setup();
    changePassword.mockResolvedValue({ error: null });
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await fillPasswordForm(user, "current-pass-1!", "brand-new-1!");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        currentPassword: "current-pass-1!",
        newPassword: "brand-new-1!",
      })
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Password changed."));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it("toasts the server refusal without re-reading the session", async () => {
    const user = userEvent.setup();
    changePassword.mockResolvedValue({ error: { message: "Wrong password" } });
    render(<SettingsPage user={userWithRole("attendee")} accounts={[]} />);

    await fillPasswordForm(user, "wrong-pass-1!", "brand-new-1!");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Wrong password"));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
