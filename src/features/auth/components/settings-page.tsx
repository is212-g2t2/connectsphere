import { useState } from "react";
import { Trash2, Link } from "lucide-react";
import { toast } from "sonner";

import type { SessionUser } from "#/features/auth/session";
import { authClient } from "#/lib/auth-client";
import { Button } from "#/components/ui/button";

const PROVIDER_LABELS: Record<string, string> = {
  credential: "Password",
};

function getProviderLabel(providerId: string) {
  return PROVIDER_LABELS[providerId] ?? providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

async function handleDeleteAccount() {
  const { error } = await authClient.deleteUser({});
  if (error) {
    toast.error(error.message ?? "Failed to delete account");
    return;
  }
  window.location.href = "/";
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
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div>
        <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Settings
        </p>
        <h1 className="font-heading mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
          Account
        </h1>
      </div>

      <div className="mt-12 space-y-10">
        {/* Identity */}
        <SettingsSection title="Profile">
          <Row label="Email" value={user.email} />
          {user.name && <Row label="Name" value={user.name} />}
          <Row label="Role" value={user.role ?? "attendee"} />
        </SettingsSection>

        {/* Linked providers */}
        <SettingsSection title="Linked providers">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No external providers linked.</p>
          ) : (
            <ul className="space-y-2">
              {accounts.map(acct => (
                <li key={acct.id} className="flex items-center gap-2">
                  <Link className="size-4 text-muted-foreground" />
                  <span className="text-sm">{getProviderLabel(acct.providerId)}</span>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        {/* Danger zone */}
        <SettingsSection title="Danger zone">
          {confirmDelete ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">
                This permanently deletes your account and all data. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={() => void handleDeleteAccount()}>
                  Yes, delete my account
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" />
              Delete account
            </Button>
          )}
        </SettingsSection>
      </div>
    </main>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h2 className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  );
}
