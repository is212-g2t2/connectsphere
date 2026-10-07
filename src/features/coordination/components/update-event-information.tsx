import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Card, CardContent } from "#/components/ui/card";
import { pickAmendments } from "#/features/event-requests/amendments";
import { EventRequestForm } from "#/features/event-requests/components/request-form";
import type { EventRequestFormSubmitContext } from "#/features/event-requests/components/request-form";
import { toDraftValues } from "#/features/event-requests/components/request-page";
import { EVENT_INFORMATION_FIELDS } from "#/features/event-requests/schema";
import type { EventRequestDraftValues } from "#/features/event-requests/schema";
import type { EventRequestDraft } from "#/features/event-requests/server-fns";
import { updateEventInformation } from "#/features/events/server-fns";

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
  // The toggle waits for a save, so a reopened form is never closed by the earlier save.
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function discardEdits() {
    // Close both at once so focus can move straight to the toggle.
    flushSync(() => {
      setConfirmOpen(false);
      setEditing(false);
      setDirty(false);
    });
    toggle.current?.focus();
  }

  async function save(
    values: EventRequestDraftValues,
    { changedFields: touchedFields }: EventRequestFormSubmitContext
  ) {
    setSaving(true);
    try {
      const result = await updateEventInformation({
        data: {
          id: request.id,
          amendments: pickAmendments(values, EVENT_INFORMATION_FIELDS, touchedFields),
        },
      });
      let reloadFailed = false;
      if (result.changedFields.length > 0) {
        try {
          await router.invalidate();
        } catch {
          // The update committed; only the re-read failed.
          reloadFailed = true;
          toast.warning("The change was saved. Refresh this page to see it.");
        }
      }
      // One commit re-enables the toggle and closes the form, so the toggle can take focus at once.
      flushSync(() => {
        setSaving(false);
        setEditing(false);
        setDirty(false);
      });
      toggle.current?.focus();
      if (result.changedFields.length === 0) toast.info("No changes to save.");
      else if (!reloadFailed) toast.success("Event information saved.");
    } catch (error) {
      // The toast outlives the panel when the re-read unmounts it; the form keeps its own
      // message when it survives. The toggle waits for the re-read so a reopen never sits stale.
      if (error instanceof Error && error.message) toast.error(error.message);
      await router.invalidate().catch(() => {});
      setSaving(false);
      throw error;
    }
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
              ref={toggle}
              type="button"
              size="sm"
              variant={editing ? "outline" : "default"}
              disabled={saving}
              aria-expanded={editing}
              aria-controls={editing ? formId : undefined}
              onClick={() => {
                if (editing && dirty) setConfirmOpen(true);
                else setEditing(open => !open);
              }}
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
                idPrefix={formId}
                onSave={save}
                onDirtyChange={setDirty}
              />
            </div>
          )}
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent size="sm" finalFocus={toggle}>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                <AlertDialogDescription>Your unsaved edits will be lost.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel size="sm">Keep editing</AlertDialogCancel>
                <AlertDialogAction size="sm" variant="destructive" onClick={discardEdits}>
                  Discard changes
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </section>
  );
}
