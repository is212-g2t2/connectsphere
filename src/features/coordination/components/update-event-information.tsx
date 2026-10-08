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
import { formatProposedWindow } from "#/features/event-requests/format";
import {
  EVENT_INFORMATION_FIELDS,
  clarificationFieldLabel,
  significantFields,
} from "#/features/event-requests/schema";
import type { EventRequestDraftValues, SignificantField } from "#/features/event-requests/schema";
import type { EventRequestDraft } from "#/features/event-requests/server-fns";
import type { OutstandingReleases } from "#/features/events/cancellation";
import { listEventArrangements, updateEventInformation } from "#/features/events/server-fns";
import { toLocalMinuteValue } from "#/features/venues/availability";

/**
 * PTR-23 AC2, AC3: the warning that waits for the Coordinator's answer before a significant
 * change is sent. `resolve(true)` saves; `resolve(false)` returns to the form with its edits.
 */
interface SignificantChangeWarning {
  fields: SignificantField[];
  arrangements: OutstandingReleases;
  resolve: (proceed: boolean) => void;
}

/**
 * PTR-22 AC2: the assigned Coordinator updates the information of an approved, planning or
 * confirmed event. The request form opens on the recorded values, every required field must stay
 * complete, and only the fields the Coordinator changed are sent. The form closes after the page
 * re-reads, so the record below already shows the new values. The caller shows this only to the
 * assigned Coordinator in those statuses. The server repeats both checks.
 *
 * PTR-23: a change to a significant field (AC1) first reads what the event holds and shows the
 * warning (AC2, AC3); the save goes ahead only once the Coordinator confirms it. An ordinary edit
 * saves at once (AC4). The server refuses a significant change sent without the confirmation.
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
  const [warning, setWarning] = useState<SignificantChangeWarning | null>(null);

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
    // Judged on the fields touched, so the warning comes before anything is sent. The server
    // judges again on what actually changed.
    const significant = significantFields(touchedFields);
    if (significant.length > 0) {
      const arrangements = await listEventArrangements({ data: { id: request.id } });
      const proceed = await new Promise<boolean>(resolve => {
        setWarning({ fields: significant, arrangements, resolve });
      });
      setWarning(null);
      // The form keeps its edits; nothing was sent.
      if (!proceed) return;
    }

    setSaving(true);
    try {
      const result = await updateEventInformation({
        data: {
          id: request.id,
          amendments: pickAmendments(values, EVENT_INFORMATION_FIELDS, touchedFields),
          ...(significant.length > 0 ? { acknowledgeSignificant: true } : {}),
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
      else if (!reloadFailed) {
        toast.success(
          result.notified > 0
            ? "Event information saved. The staff holding its arrangements have been notified."
            : "Event information saved."
        );
      }
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
                A saved change replaces the recorded value for everyone with access to this event. A
                change to the dates and times, expected attendance, venue requirements or equipment
                requirements is significant: you are warned first, and the staff holding a booking
                or reservation are told.
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
            <div id={formId} className="mt-4 max-w-3xl">
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
          <SignificantChangeDialog warning={warning} />
        </CardContent>
      </Card>
    </section>
  );
}

/** A floating venue-local period (`2026-12-05 10:00:00`) in the proposed-window wording. */
function formatPeriod(startsAt: string, endsAt: string): string {
  return formatProposedWindow({
    start: toLocalMinuteValue(startsAt),
    end: toLocalMinuteValue(endsAt),
  });
}

/**
 * PTR-23 AC2, AC3: the warning before a significant change is saved. It names every booking,
 * tentative hold and reservation the event holds, or says that it holds none, and that saving
 * changes, cancels and re-statuses none of them. Closing the dialog in any way other than
 * "Save anyway" returns to the form.
 */
function SignificantChangeDialog({ warning }: { warning: SignificantChangeWarning | null }) {
  const arrangements = warning?.arrangements;
  const items = arrangements
    ? [
        ...arrangements.venueBookings.map(booking => ({
          id: `booking-${booking.id}`,
          content: `Venue booking: ${booking.venueName}, ${formatPeriod(booking.startsAt, booking.endsAt)}`,
        })),
        ...arrangements.venueHolds.map(hold => ({
          id: `hold-${hold.id}`,
          content: `Tentative hold: ${hold.venueName}, ${formatPeriod(hold.startsAt, hold.endsAt)}`,
        })),
        ...arrangements.equipmentReservations.map(line => ({
          id: `equipment-${line.id}`,
          content: `Equipment reservation: ${line.item} × ${line.quantity}`,
        })),
      ]
    : [];
  const staffHold =
    arrangements !== undefined &&
    (arrangements.venueBookings.length > 0 || arrangements.equipmentReservations.length > 0);
  const changed = new Intl.ListFormat("en-GB", { type: "conjunction" }).format(
    (warning?.fields ?? []).map(field => clarificationFieldLabel(field).toLowerCase())
  );

  return (
    <AlertDialog
      open={warning !== null}
      onOpenChange={open => {
        if (!open) warning?.resolve(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This is a significant change</AlertDialogTitle>
          <AlertDialogDescription>
            Changing the {changed} affects what has already been arranged for this event. Saving
            changes, cancels or re-statuses none of the arrangements: revisit each one yourself.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {items.length === 0 ? (
          <p className="body-sm text-muted-foreground">
            This event holds no venue booking, tentative hold or equipment reservation.
          </p>
        ) : (
          <div className="space-y-3">
            <ul
              aria-label="Arrangements this event holds"
              className="list-disc space-y-1 pl-5 body-sm"
            >
              {items.map(item => (
                <li key={item.id}>{item.content}</li>
              ))}
            </ul>
            {staffHold && (
              <p className="body-sm text-muted-foreground">
                The Venue Staff holding a booking and the Technical Support holding a reservation
                will be told what changed.
              </p>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={() => warning?.resolve(true)}>Save anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
