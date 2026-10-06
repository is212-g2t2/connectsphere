import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import { toDraftValues } from "#/features/event-requests/components/request-page";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";
import type { EventRequestDraft } from "#/features/event-requests/server-fns";
import { updateEventInformation } from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";

const UPDATE_FAILED = "Could not save the event information. Try again.";

/**
 * PTR-22 AC2: the assigned Coordinator updates the event's information during planning. The
 * request form opens on the recorded values, and every required field must stay complete. A save
 * closes the form and re-reads the page, so the record below shows the new values. The caller
 * shows this only to the assigned Coordinator of an approved, planning or confirmed event. The
 * server repeats both checks and refuses an edit that the page allowed when it loaded.
 */
export function UpdateEventInformation({ request }: { request: EventRequestDraft }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [, update] = useMutation(
    (values: EventRequestDraftValues) =>
      updateEventInformation({ data: { ...values, id: request.id } }),
    UPDATE_FAILED
  );

  // The form owns its submitting flag and error map, so a failure is thrown back to it.
  async function save(values: EventRequestDraftValues) {
    const result = await update(values);
    if (result.status !== "success") throw new Error(result.error ?? UPDATE_FAILED);
    setEditing(false);
    toast.success(
      result.data.changedFields.length === 0 ? "No changes to save." : "Event information saved."
    );
    await router.invalidate();
  }

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
              type="button"
              size="sm"
              variant={editing ? "outline" : "default"}
              onClick={() => setEditing(open => !open)}
            >
              {editing ? "Cancel" : "Edit event information"}
            </Button>
          </div>
          {editing && (
            <div className="mt-6">
              <EventRequestForm
                initialValues={toDraftValues(request)}
                onSave={save}
                saveLabel="Save changes"
                requireComplete
                idPrefix="event-information"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
