import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Link, Trash } from "lucide-react";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { PasswordInput } from "#/features/auth/components/password-input";
import { PasswordSchema } from "#/features/auth/schema/password";
import { roleLabel } from "#/features/auth/schema/role";
import type { SessionUser } from "#/features/auth/session";
import { useMutation } from "#/hooks/use-mutation";
import { authClient } from "#/lib/auth-client";

const PROVIDER_LABELS: Record<string, string> = {
  credential: "Password",
};

const DELETE_FAILED = "Failed to delete account";

function getProviderLabel(providerId: string) {
  return PROVIDER_LABELS[providerId] ?? providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

/**
 * The account settings view. Both the session user and the linked accounts arrive as props —
 * the route reads them from its context and loader — so this renders without a router for the
 * profile content (PTR-75); only the mutation paths call `useRouter`, which tests mock.
 *
 * `accounts` is narrowed to what the list actually shows rather than Better Auth's full row:
 * the wider type would tie the view to the loader's serialisation.
 *
 * `SessionUser` carries no verification flag, so the page shows none. The role stays read-only:
 * the server rejects `/update-user` role changes, and an administrator creates staff accounts.
 */
export function SettingsPage({
  user,
  accounts,
}: {
  user: SessionUser;
  accounts: { id: string; providerId: string }[];
}) {
  // PTR-71: deleting an account used to run as a bare `void handleDeleteAccount()` — nothing
  // tracked it, so both buttons stayed live and a second click could fire a second delete. The
  // action owns the in-flight flag, and the redirect on success stays inside it.
  const [, deleteAccount, deleting] = useMutation(async () => {
    const { error } = await authClient.deleteUser({});
    if (error) {
      throw new Error(error.message ?? DELETE_FAILED);
    }

    window.location.href = "/";
  }, DELETE_FAILED);

  async function handleDeleteAccount() {
    const { error } = await deleteAccount();
    if (error) {
      toast.error(error);
    }
  }

  return (
    <Page width="page">
      <PageHeader eyebrow="Settings" title="Account" />

      <div className="mt-8 space-y-6">
        {/* Identity */}
        <SettingsSection title="Profile">
          <Row label="Email" value={user.email} />
          <ProfileNameForm user={user} />
          <div>
            <Row label="Role" value={roleLabel(user.role)} />
            <FieldDescription className="mt-1">
              Staff accounts are created by an administrator. Your role cannot be changed here.
            </FieldDescription>
          </div>
        </SettingsSection>

        {/* Password */}
        <SettingsSection title="Change password">
          <PasswordForm />
        </SettingsSection>

        {/* Sign-in */}
        <SettingsSection title="Sign-in">
          {accounts.length === 0 ? (
            <p className="body-sm text-muted-foreground">No external providers linked.</p>
          ) : (
            <ul className="space-y-2">
              {accounts.map(acct => (
                <li key={acct.id} className="flex items-center gap-2">
                  <Link className="size-4 text-muted-foreground" />
                  <span className="body-sm">{getProviderLabel(acct.providerId)}</span>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        {/* Danger zone */}
        <SettingsSection title="Danger zone">
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
              <Trash className="size-4" />
              Delete account
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete account</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes your account and all data. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* Backing out mid-delete would only hide a deletion that is still running. */}
                <AlertDialogCancel size="sm" disabled={deleting}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void handleDeleteAccount()}
                >
                  {deleting ? "Deleting…" : "Yes, delete my account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsSection>
      </div>
    </Page>
  );
}

/** Edit the display name through Better Auth, then re-read the session for the header. */
function ProfileNameForm({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [name, setName] = useState(user.name ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [, saveName, saving] = useMutation(async (trimmed: string) => {
    const { error } = await authClient.updateUser({ name: trimmed });
    if (error) {
      throw new Error(error.message ?? "Could not update your profile. Try again.");
    }
    toast.success("Profile updated.");
    await router.invalidate();
  }, "Could not update your profile. Try again.");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setValidationError("Enter your name");
      return;
    }
    if (trimmed.length > 100) {
      setValidationError("Name must be at most 100 characters");
      return;
    }
    setValidationError(null);
    const state = await saveName(trimmed);
    if (state.status === "error") {
      toast.error(state.error);
    }
  }

  return (
    <form noValidate onSubmit={event => void handleSubmit(event)}>
      <Field>
        <FieldLabel htmlFor="settings-name">Name</FieldLabel>
        <Input
          id="settings-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={event => setName(event.target.value)}
          aria-invalid={validationError !== null}
        />
        {validationError ? <FieldError>{validationError}</FieldError> : null}
      </Field>
      <div className="mt-3">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/** Change the password through Better Auth. The policy matches sign-up and reset. */
function PasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<{
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>({});
  const [, savePassword, saving] = useMutation(
    async (input: { currentPassword: string; newPassword: string }) => {
      const { error } = await authClient.changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      });
      if (error) {
        throw new Error(error.message ?? "Could not change your password. Try again.");
      }
      toast.success("Password changed.");
      await router.invalidate();
    },
    "Could not change your password. Try again."
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!currentPassword) {
      next.currentPassword = "Enter your current password";
    }
    const parsed = PasswordSchema.safeParse(newPassword);
    if (!parsed.success) {
      next.newPassword = parsed.error.issues[0].message;
    }
    if (confirmPassword !== newPassword) {
      next.confirmPassword = "Passwords do not match";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      return;
    }
    const state = await savePassword({ currentPassword, newPassword });
    if (state.status === "error") {
      toast.error(state.error);
    } else {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }

  return (
    <form noValidate onSubmit={event => void handleSubmit(event)}>
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor="current-password">Current password</FieldLabel>
          <PasswordInput
            id="current-password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
            aria-invalid={errors.currentPassword !== undefined}
          />
          {errors.currentPassword ? <FieldError>{errors.currentPassword}</FieldError> : null}
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              showRules
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              aria-invalid={errors.newPassword !== undefined}
            />
            {errors.newPassword ? <FieldError>{errors.newPassword}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              aria-invalid={errors.confirmPassword !== undefined}
            />
            {errors.confirmPassword ? <FieldError>{errors.confirmPassword}</FieldError> : null}
          </Field>
        </div>
        <div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Changing…" : "Change password"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent>
        <h2 className="display-h3">{title}</h2>
        <div className="mt-4 space-y-4">{children}</div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="body-sm text-muted-foreground">{label}</span>
      <span className="truncate body-sm font-medium">{value}</span>
    </div>
  );
}
