import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2, KeyRound, Link } from "lucide-react";
import type { Passkey } from "@better-auth/passkey";
import { toast } from "sonner";

import { getCurrentUser } from "#/features/auth/session";
import { authClient } from "#/lib/auth-client";
import { Button } from "#/components/ui/button";
import { createSeoHead } from "#/lib/seo";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  "email-otp": "Email OTP",
  credential: "Password",
};

function getProviderLabel(providerId: string) {
  return PROVIDER_LABELS[providerId] ?? providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

export const Route = createFileRoute("/settings")({
  head: () =>
    createSeoHead({
      title: "Settings — TanStack Start Template",
      noindex: true,
    }),
  beforeLoad: async () => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/login" });
    }

    return { user };
  },
  component: SettingsPage,
});

async function handleDeleteAccount() {
  const { error } = await authClient.deleteUser({});
  if (error) {
    toast.error(error.message ?? "Failed to delete account");
    return;
  }
  window.location.href = "/";
}

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const { data: passkeys } = authClient.useListPasskeys();
  const { data: accounts = [] } = useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const res = await authClient.listAccounts();
      return res.data ?? [];
    },
  });
  const [deletingPasskey, setDeletingPasskey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDeletePasskey(passkeyId: string) {
    setDeletingPasskey(passkeyId);
    const { error } = await authClient.passkey.deletePasskey({ id: passkeyId });
    if (error) {
      toast.error(error.message ?? "Failed to delete passkey");
    }
    setDeletingPasskey(null);
  }

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
        </SettingsSection>

        {/* Linked providers */}
        <SettingsSection title="Linked providers">
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="space-y-2">
              {accounts.map((acct: { id: string; providerId: string }) => (
                <li key={acct.id} className="flex items-center gap-2">
                  <Link className="size-4 text-muted-foreground" />
                  <span className="text-sm">{getProviderLabel(acct.providerId)}</span>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>

        {/* Passkeys */}
        <SettingsSection title="Passkeys">
          {!passkeys || passkeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No passkeys registered.</p>
          ) : (
            <ul className="space-y-2">
              {passkeys.map((pk: Passkey) => (
                <li key={pk.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4 text-muted-foreground" />
                    <span className="text-sm">{pk.name ?? "Passkey"}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={deletingPasskey === pk.id}
                    aria-label={`Delete passkey: ${pk.name ?? "Passkey"}`}
                    onClick={() => void handleDeletePasskey(pk.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() =>
                void (async () => {
                  const { error } = await authClient.passkey.addPasskey();
                  if (error) toast.error(error.message ?? "Failed to add passkey");
                })()
              }
            >
              <KeyRound className="size-4" />
              Add passkey
            </Button>
          </div>
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
