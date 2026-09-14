import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { can } from "#/features/auth/permissions";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import { saveEventRequestDraft } from "#/features/event-requests/server-fns";
import { createSeoHead } from "#/lib/seo";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

export const Route = createFileRoute("/_authenticated/event-requests")({
  head: () =>
    createSeoHead({
      title: "Event requests — ConnectSphere",
      noindex: true,
    }),
  beforeLoad: ({ context }) => {
    if (!can(context.user.role, { event_request: ["create"] })) {
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
            // A handler-thrown `Response` resolves rather than rejects on the in-app client (the
            // server stamps it `x-tss-raw`, and `serverFnFetcher` returns it before its
            // `!response.ok` check), so the refusal has to be turned back into a rejection here.
            // It arrives as `unknown` because `Response.status` (a number) conflicts with the
            // row's own `status`, and TypeScript collapses that union to `never`.
            const result: unknown = await saveEventRequestDraft({
              data: { ...values, id: draftId },
            });

            if (result instanceof Response) {
              throw new Error((await result.text()) || "Could not save this draft. Try again.");
            }

            if (
              typeof result !== "object" ||
              result === null ||
              !("id" in result) ||
              typeof result.id !== "number"
            ) {
              throw new Error("Could not save this draft. Try again.");
            }

            setDraftId(result.id);
            setSaved(true);
          }}
        />
      </div>
    </main>
  );
}
