import { useId, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { pickAmendments } from "#/features/event-requests/amendments";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import { toDraftValues } from "#/features/event-requests/components/request-page";
import { CLARIFICATION_FIELDS } from "#/features/event-requests/schema";
import type { EventRequestDraft } from "#/features/event-requests/server-fns";
import { updateEventInformation } from "#/features/events/server-fns";

const EVENT_INFORMATION_FIELDS = CLARIFICATION_FIELDS.map(field => field.key);

/**
 * PTR-22 AC2: the assigned Coordinator updates the information of an approved, planning or
 * confirmed event. The request form opens on the recorded values, every required field must stay
 * complete, and only the fields the Coordinator changed are sent. The form closes after the page
 * re-reads, so the record below already shows the new values. The caller shows this only to the
 * assigned Coordinator in those statuses. The server repeats both checks.
 */
export function UpdateEventInformation({ request }: { request: EventRequestDraft }) {
  const router = useRouter();
  const formId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);

  return (
    <section className="mt-8" aria-labelledby="update-information-heading">
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="update-information-heading" className="display-h3">
                Update event information
              </h2>
              <p className="mt-2 body-sm text-muted-foreground">
                A saved change replaces the recorded value for everyone with access to this event.
              </p>
            </div>
            <Button
              ref={toggle}
              type="button"
              size="sm"
              variant={editing ? "outline" : "default"}
              aria-expanded={editing}
              aria-controls={editing ? formId : undefined}
              onClick={() => setEditing(open => !open)}
            >
              {editing ? "Cancel editing" : "Edit event information"}
            </Button>
          </div>
          {editing && (
            <div id={formId} className="mt-6">
              <EventRequestForm
                initialValues={toDraftValues(request)}
                saveLabel="Save changes"
                requireComplete
                onSave={async (values, { changedFields }) => {
                  const { changedFields: saved } = await updateEventInformation({
                    data: {
                      id: request.id,
                      amendments: pickAmendments(values, EVENT_INFORMATION_FIELDS, changedFields),
                    },
                  });
                  try {
                    await router.invalidate();
                  } catch {
                    // The update committed; only the re-read failed.
                    toast.warning("The change was saved. Refresh this page to see it.");
                  }
                  setEditing(false);
                  toggle.current?.focus();
                  if (saved.length === 0) toast.info("No changes to save.");
                  else toast.success("Event information saved.");
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
