import { useCallback, useEffect, useId, useRef, useState } from "react";
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
import { formatVenuePeriod } from "#/features/event-requests/format";
import {
  EVENT_INFORMATION_FIELDS,
  significantFieldPhrase,
  significantFields,
} from "#/features/event-requests/schema";
import type { EventRequestDraftValues, SignificantField } from "#/features/event-requests/schema";
import type { EventRequestDetail, EventRequestDraft } from "#/features/event-requests/server-fns";
import type { OutstandingReleases } from "#/features/events/cancellation";
import { listEventArrangements, updateEventInformation } from "#/features/events/server-fns";

/**
 * PTR-23 AC2, AC3: the warning that waits for the Coordinator's answer before a significant
 * change is sent. The save has to stay inside the form's own submit, which owns the submitting
 * flag and the error message, so the submit awaits a promise that the dialog settles rather than
 * handing the values to a second action: `resolve(true)` saves; `resolve(false)` returns to the
 * form with its edits.
 */
interface SignificantChangeWarning {
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
 *
 * PTR-52: with `applying` set, the form is open on the Organiser's change request, pinned above
 * it, and the save carries the request's id so the server marks it applied and tells the Organiser
 * in the same transaction (AC2, AC5). The caller shows the form in that mode in every status the
 * request could be raised in, derives `applying` from the live record so a request processed
 * elsewhere closes the form on the next read, and is told through `onApplyEnd` when the save lands
 * or the form is closed. `onDirtyChange` lets it hold other applies while edits are unsaved.
 */
export function UpdateEventInformation(props: UpdateEventInformationProps) {
  // An apply replaces an open direct edit: the key remounts the form on apply/dispose, so no
  // direct-edit state survives the switch. Every CoordinatorInformationForm call site shares
  // this, in the change requests section and the event information section alike.
  return <UpdateEventInformationBody key={props.applying?.id ?? "edit"} {...props} />;
}

type UpdateEventInformationProps = {
  request: EventRequestDraft;
  applying?: Pick<
    EventRequestDetail["changeRequests"][number],
    "id" | "whatShouldChange" | "requestedValue"
  > | null;
  onApplyEnd?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

function UpdateEventInformationBody({
  request,
  applying = null,
  onApplyEnd,
  onDirtyChange,
}: UpdateEventInformationProps) {
  const router = useRouter();
  const formId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const applyingHeading = useRef<HTMLHeadingElement>(null);
  const [editingSelf, setEditingSelf] = useState(false);
  // An apply opens the form from the decisions card, so the request's own state cannot close it;
  // the form is open for either reason. The wrapper remounts on apply/dispose, so an apply
  // always replaces an open direct edit with a fresh form.
  const editing = applying !== null || editingSelf;
  const applyingId = applying?.id;
  // The decisions card sits above; the reader lands on the pinned request, not where they were.
  useEffect(() => {
    if (applyingId !== undefined) applyingHeading.current?.focus();
  }, [applyingId]);
  // The caller holds other applies while this form has unsaved edits (PTR-52). A form closed
  // from outside — the request processed elsewhere, the page re-read — reports clean on its way
  // out, so nothing stays held after it is gone.
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange]
  );
  // The toggle waits for a save, so a reopened form is never closed by the earlier save.
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const saveLabel = applying ? "Save and mark applied" : "Save changes";
  const [confirmOpen, setConfirmOpen] = useState(false);
  // From the arrangements read until the Coordinator answers the warning: the toggle waits, so
  // the form cannot be discarded under a warning that would still save its edits.
  const [confirming, setConfirming] = useState(false);
  const [warning, setWarning] = useState<SignificantChangeWarning | null>(null);
  // The warning keeps its content after it closes, so the dialog does not rewrite itself while it
  // fades out. `warningOpen` says whether it shows.
  const [warningOpen, setWarningOpen] = useState(false);

  const reportDirty = useCallback(
    (next: boolean) => {
      setDirty(next);
      onDirtyChange?.(next);
    },
    [onDirtyChange]
  );

  function closeForm() {
    setEditingSelf(false);
    reportDirty(false);
    if (applying) onApplyEnd?.();
  }

  function discardEdits() {
    // Close both at once so focus can move straight to the toggle. An apply came from the
    // decisions card, and `onApplyEnd` returns focus there instead.
    flushSync(() => {
      setConfirmOpen(false);
      closeForm();
    });
    if (!applying) toggle.current?.focus();
  }

  async function save(
    values: EventRequestDraftValues,
    { changedFields: touchedFields }: EventRequestFormSubmitContext
  ) {
    // Judged on the fields touched, so the warning comes before anything is sent. The server
    // judges again on what actually changed.
    const significant = significantFields(touchedFields);
    if (significant.length > 0) {
      setConfirming(true);
      let proceed = false;
      try {
        const arrangements = await listEventArrangements({ data: { id: request.id } });
        proceed = await new Promise<boolean>(resolve => {
          setWarning({ arrangements, resolve });
          setWarningOpen(true);
        });
      } catch (error) {
        // As a failed save does: the page re-reads, so a lost assignment or a closed event
        // removes the form instead of leaving it to fail on every retry.
        if (error instanceof Error && error.message) toast.error(error.message);
        await router.invalidate().catch(() => {});
        throw error;
      } finally {
        setWarningOpen(false);
        setConfirming(false);
      }
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
          ...(applying ? { changeRequestId: applying.id } : {}),
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
        closeForm();
      });
      if (!applying) toggle.current?.focus();
      if (result.changedFields.length === 0) toast.info("No changes to save.");
      else if (!reloadFailed) {
        const staff =
          result.notified > 0 ? " The staff holding its arrangements will be notified." : "";
        toast.success(
          applying
            ? `Change request applied. The Organiser will be notified.${staff}`
            : `Event information saved.${staff}`
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

  let toggleLabel = "Edit event information";
  if (editing) toggleLabel = "Cancel editing";
  if (applying) toggleLabel = "Cancel applying";

  function onToggle() {
    if (editing && dirty) setConfirmOpen(true);
    else if (editing) closeForm();
    else setEditingSelf(true);
  }

  return (
    <section className="mt-8" aria-labelledby="update-information-heading">
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="update-information-heading" className="display-h3">
                {applying ? "Apply the change request" : "Update event information"}
              </h2>
              <p className="mt-2 body-sm text-muted-foreground">
                A saved change replaces the recorded value for everyone with access to this event. A
                change to the dates and times, expected attendance, venue requirements or equipment
                requirements needs your confirmation before it is saved.
              </p>
            </div>
            <Button
              ref={toggle}
              type="button"
              size="sm"
              variant={editing ? "outline" : "default"}
              disabled={saving || confirming}
              aria-expanded={editing}
              aria-controls={editing ? formId : undefined}
              onClick={onToggle}
            >
              {toggleLabel}
            </Button>
          </div>
          {editing && (
            <div id={formId} className="mt-4 max-w-3xl">
              {applying && (
                <div className="mb-6 rounded-md border border-border bg-muted/40 p-4">
                  <h3 ref={applyingHeading} tabIndex={-1} className="display-h3 outline-none">
                    Applying the Organiser&apos;s change request
                  </h3>
                  <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="eyebrow text-muted-foreground">What should change</dt>
                      <dd className="mt-2 body-md font-medium whitespace-pre-line">
                        {applying.whatShouldChange}
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow text-muted-foreground">Requested new value</dt>
                      <dd className="mt-2 body-md font-medium whitespace-pre-line">
                        {applying.requestedValue}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 body-sm text-muted-foreground">
                    Make the change in the form, then save. The request is marked applied with the
                    save, and the Organiser is told.
                  </p>
                </div>
              )}
              <EventRequestForm
                key={applying ? `apply-${applying.id}` : "edit"}
                initialValues={toDraftValues(request)}
                saveLabel={saveLabel}
                busyLabel={saving ? "Saving…" : saveLabel}
                requireComplete
                idPrefix={formId}
                onSave={save}
                onDirtyChange={reportDirty}
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
          <SignificantChangeDialog warning={warning} open={warningOpen} />
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * PTR-23 AC2, AC3: the warning before a significant change is saved. It names every booking,
 * tentative hold and reservation the event holds, or says that it holds none, and that saving
 * changes, cancels and releases none of them. "Save anyway" settles the promise with true; the
 * dialog's own close (Go back, Escape) settles it with false. Base UI's close runs only for its
 * own close paths, so the two never settle the same promise twice.
 */
function SignificantChangeDialog({
  warning,
  open,
}: {
  warning: SignificantChangeWarning | null;
  open: boolean;
}) {
  const arrangements = warning?.arrangements;
  const items = arrangements
    ? [
        ...arrangements.venueBookings.map(booking => ({
          id: `booking-${booking.id}`,
          content: `Venue booking: ${booking.venueName}, ${formatVenuePeriod(booking.startsAt, booking.endsAt)}`,
        })),
        ...arrangements.venueHolds.map(hold => ({
          id: `hold-${hold.id}`,
          content: `Tentative hold: ${hold.venueName}, ${formatVenuePeriod(hold.startsAt, hold.endsAt)}`,
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

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) warning?.resolve(false);
      }}
    >
      {/* The list can be long (an event may hold many lines), so the popup scrolls inside the
          viewport. */}
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle>This is a significant change</AlertDialogTitle>
          <AlertDialogDescription>
            {items.length === 0
              ? "This event holds no venue booking, tentative hold or equipment reservation."
              : "This event holds the arrangements below. Saving does not change, cancel or release any of them: review each one yourself."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {items.length > 0 && (
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
                The Venue Staff and Technical Support who still hold one of these will be notified
                of the change.
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
