import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { can } from "#/features/auth/permissions";
import { getCurrentUser } from "#/features/auth/session";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import { saveEventRequestDraft } from "#/features/event-requests/server-fns";
import { createSeoHead } from "#/lib/seo";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export const Route = createFileRoute("/event-requests")({
  head: () =>
    createSeoHead({
      title: "Event requests — ConnectSphere",
      noindex: true,
    }),
  beforeLoad: async () => {
    const user = await getCurrentUser();

    if (!user) {
      throw redirect({ to: "/login" });
    }

    if (!can(user.role, { event_request: ["create"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: EventRequestsPage,
});

function EventRequestsPage() {
  const [saved, setSaved] = useState(false);
  // Held for the rest of the sitting so saving again edits this draft instead of opening
  // another one beside it. Resuming a draft in a *later* sitting is PTR-12.
  const [draftId, setDraftId] = useState<number | undefined>(undefined);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <h1 className="font-heading mt-6 text-3xl font-semibold tracking-tight">New event request</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Save what you know now and finish the details later.
      </p>

      {saved && (
        <output className="mt-6 block text-sm font-medium text-foreground">Draft saved.</output>
      )}

      <div className="mt-10">
        <EventRequestForm
          onSave={async values => {
            setSaved(false);
            const request = await saveEventRequestDraft({ data: { ...values, id: draftId } });
            setDraftId(request.id);
            setSaved(true);
          }}
        />
      </div>
    </main>
  );
}
