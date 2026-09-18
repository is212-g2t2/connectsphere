import { Trash2, Link } from "lucide-react";
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
 * the route reads them from its context and loader — so this renders without a router (PTR-75).
 *
 * `accounts` is narrowed to what the list actually shows rather than Better Auth's full row:
 * the wider type would tie the view to the loader's serialisation.
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
          {user.name && <Row label="Name" value={user.name} />}
          <Row label="Role" value={user.role ?? "attendee"} />
        </SettingsSection>

        {/* Linked providers */}
        <SettingsSection title="Linked providers">
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
              <Trash2 className="size-4" />
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
