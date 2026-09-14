import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { unwrapRefusal } from "#/features/auth/session";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import { saveEventRequestDraft } from "#/features/event-requests/server-fns";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/** Capturing a new event request as a draft. The route holds the role guard; this holds the view. */
export function EventRequestsPage() {
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
            const draft = await unwrapRefusal(
              await saveEventRequestDraft({ data: { ...values, id: draftId } }),
              "Could not save this draft. Try again."
            );

            setDraftId(draft.id);
            setSaved(true);
          }}
        />
      </div>
    </main>
  );
}
