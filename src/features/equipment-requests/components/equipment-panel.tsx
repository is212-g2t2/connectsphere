import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import {
  EQUIPMENT_NO_LINES_MESSAGE,
  EquipmentLineFormInput,
  isEquipmentEditableStatus,
} from "#/features/equipment-requests/schema";
import type { EquipmentLine } from "#/features/equipment-requests/schema";
import {
  removeEquipmentLine,
  saveEquipmentLine,
  submitEquipmentRequest,
} from "#/features/equipment-requests/server-fns";
import { parseWholeNumber } from "#/features/event-requests/schema";
import { useMutation } from "#/hooks/use-mutation";

interface EquipmentPanelProps {
  eventId: number;
  lines: EquipmentLine[];
  /** Event status — the panel is only editable on `approved` or `planning`. */
  status: string;
  submittedAt: string | null;
}

const EMPTY_FORM = { item: "", quantity: "", notes: "" };

/**
 * The toast text for a settled submit. The counts are all the panel needs: no recipients is a
 * different message from every recipient failing, which is different again from some failing.
 * Exported pure so the four branches are unit-testable without a browser.
 */
export function submitToastMessage(result: {
  recipientCount: number;
  failedCount: number;
}): string {
  if (result.recipientCount === 0) {
    return "Equipment requirements submitted. No Technical Support Staff to notify.";
  }
  if (result.failedCount === result.recipientCount) {
    return "Equipment requirements submitted, but no notifications were delivered.";
  }
  if (result.failedCount > 0) {
    return "Equipment requirements sent to Technical Support; some notifications failed.";
  }
  return "Equipment requirements sent to Technical Support.";
}

/**
 * PTR-38: the Coordinator's equipment management surface on the event card. Renders the current
 * lines with edit/remove controls, an inline add form, and a submit button that notifies
 * Technical Support Staff. The panel is read-only when the event is confirmed or past.
 */
export function EquipmentPanel({ eventId, lines, status, submittedAt }: EquipmentPanelProps) {
  const router = useRouter();
  const editable = isEquipmentEditableStatus(status);
  const alreadySubmitted = submittedAt !== null;
  const canEditLines = editable && !alreadySubmitted;
  const submittedCaptionId = `equipment-submitted-${eventId}`;
  const emptyStateId = `equipment-empty-${eventId}`;
  const [editing, setEditing] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  // Which line the remove mutation last ran for, so a failure shows only in that line's dialog.
  const [removeErrorId, setRemoveErrorId] = useState<string | null>(null);
  // Whether the current dialog sitting has been confirmed, so a stale error is not shown on reopen.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const submitInFlight = useRef(false);

  const closeFormAndRefresh = () => {
    setEditing(null);
    void router.invalidate();
  };

  const cancelForm = () => setEditing(null);

  const [removeState, remove, removing] = useMutation(async (id: string) => {
    await removeEquipmentLine({ data: { eventId, id } });
    toast.success("Equipment line removed.");
    await router.invalidate();
  }, "Could not remove this line. Try again.");

  const [submitState, submit, submitting] = useMutation(async () => {
    const result = await submitEquipmentRequest({ data: { eventId } });
    toast.success(submitToastMessage(result));
    await router.invalidate();
    return result;
  }, "Could not submit the equipment request. Try again.");

  // A same-tick double dispatch never reaches the mutation twice: `disabled` only drops the second
  // click after a re-render, which two dispatches in one tick can both beat.
  const handleConfirmSubmit = async () => {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitAttempted(true);
    try {
      const result = await submit();
      if (result.status === "success") {
        setSubmitOpen(false);
      } else {
        // Losing a cross-tab race leaves this view stale; refresh so the panel catches up.
        void router.invalidate();
      }
    } finally {
      submitInFlight.current = false;
    }
  };

  const submitDescribedBy =
    [
      lines.length === 0 && editing === null ? emptyStateId : null,
      alreadySubmitted ? submittedCaptionId : null,
    ]
      .filter(id => id !== null)
      .join(" ") || undefined;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <p className="body-sm font-medium">Equipment requirements</p>
        {canEditLines && editing === null && (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            Add line
          </Button>
        )}
      </div>

      {lines.length === 0 && editing === null && (
        <p id={emptyStateId} className="mt-3 body-sm text-muted-foreground">
          {canEditLines ? EQUIPMENT_NO_LINES_MESSAGE : "No equipment lines recorded."}
        </p>
      )}

      {lines.length > 0 && (
        <ul className="mt-3 space-y-3">
          {lines.map(line => (
            <li key={line.id}>
              {editing === line.id ? (
                <LineForm
                  key={line.id}
                  eventId={eventId}
                  defaults={{
                    item: line.item,
                    quantity: String(line.quantity),
                    notes: line.notes ?? "",
                  }}
                  lineId={line.id}
                  onDone={closeFormAndRefresh}
                  onCancel={cancelForm}
                />
              ) : (
                <div className="flex items-start justify-between gap-4 body-sm">
                  <div>
                    <span className="font-medium">{line.item}</span>
                    <span className="text-muted-foreground"> × {line.quantity}</span>
                    {line.notes && <p className="mt-0.5 text-muted-foreground">{line.notes}</p>}
                  </div>
                  {canEditLines && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${line.item}`}
                        onClick={() => setEditing(line.id)}
                        disabled={removing}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${line.item}`}
                              disabled={removing}
                            />
                          }
                        >
                          <Trash2 className="size-4" />
                        </AlertDialogTrigger>
                        <AlertDialogContent size="sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove equipment line</AlertDialogTitle>
                            <AlertDialogDescription>
                              Remove <strong>{line.item}</strong> × {line.quantity} from the
                              equipment list?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel size="sm" disabled={removing}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              size="sm"
                              disabled={removing}
                              onClick={() => {
                                setRemoveErrorId(line.id);
                                void remove(line.id);
                              }}
                            >
                              {removing ? "Removing…" : "Remove"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                          {removeState.status === "error" && removeErrorId === line.id && (
                            <p role="alert" className="body-sm text-destructive">
                              {removeState.error}
                            </p>
                          )}
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEditLines && editing === "new" && (
        <div className="mt-3">
          <LineForm
            eventId={eventId}
            defaults={EMPTY_FORM}
            lineId={undefined}
            onDone={closeFormAndRefresh}
            onCancel={cancelForm}
          />
        </div>
      )}

      {editable && (
        <div className="mt-5 border-t border-border pt-4">
          <AlertDialog
            open={submitOpen}
            onOpenChange={open => {
              setSubmitOpen(open);
              if (open) setSubmitAttempted(false);
            }}
          >
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={lines.length === 0 || submitting || alreadySubmitted}
                  aria-describedby={submitDescribedBy}
                />
              }
            >
              {submitting ? "Submitting…" : "Submit to Technical Support"}
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Submit equipment requirements</AlertDialogTitle>
                <AlertDialogDescription>
                  This will notify all Technical Support Staff of the {lines.length} equipment{" "}
                  {lines.length === 1 ? "line" : "lines"} recorded for this event.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel size="sm" disabled={submitting}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  size="sm"
                  disabled={submitting}
                  onClick={() => void handleConfirmSubmit()}
                >
                  {submitting ? "Submitting…" : "Confirm"}
                </AlertDialogAction>
              </AlertDialogFooter>
              {submitAttempted && submitState.status === "error" && (
                <p role="alert" className="body-sm text-destructive">
                  {submitState.error}
                </p>
              )}
            </AlertDialogContent>
          </AlertDialog>
          {alreadySubmitted && (
            <p id={submittedCaptionId} className="mt-2 body-sm text-muted-foreground">
              Submitted to Technical Support. Contact them to change these lines.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Inline add / edit form ────────────────────────────────────────────────────────────────────

interface LineFormProps {
  eventId: number;
  defaults: { item: string; quantity: string; notes: string };
  lineId: string | undefined;
  onDone: () => void;
  onCancel: () => void;
}

function LineForm({ eventId, defaults, lineId, onDone, onCancel }: LineFormProps) {
  const form = useForm({
    defaultValues: defaults,
    validators: { onSubmit: EquipmentLineFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await saveEquipmentLine({
          data: {
            eventId,
            id: lineId,
            item: value.item,
            quantity: parseWholeNumber(value.quantity),
            notes: value.notes === "" ? undefined : value.notes,
          },
        });
        toast.success(lineId ? "Equipment line updated." : "Equipment line added.");
        onDone();
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: error instanceof Error ? error.message : "Could not save this line. Try again.",
          },
        });
      }
    },
  });

  return (
    <form
      noValidate
      className="space-y-3 rounded-lg border border-border p-4"
      onSubmit={e => {
        e.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="item">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`equipment-item-${lineId ?? "new"}`}>
                Equipment type (required)
              </FieldLabel>
              <Input
                id={`equipment-item-${lineId ?? "new"}`}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={e => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                required
                placeholder="e.g. Projector"
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the add form opens on demand; focus lands on its first field
                autoFocus={lineId === undefined}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="quantity">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor={`equipment-qty-${lineId ?? "new"}`}>
                Quantity (required)
              </FieldLabel>
              <Input
                id={`equipment-qty-${lineId ?? "new"}`}
                type="number"
                min={1}
                step={1}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={e => field.handleChange(e.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                required
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>
      </div>

      <form.Field name="notes">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={`equipment-notes-${lineId ?? "new"}`}>Technical notes</FieldLabel>
            <Textarea
              id={`equipment-notes-${lineId ?? "new"}`}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={e => field.handleChange(e.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              placeholder="Any setup or configuration notes"
              rows={2}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={state => state.errorMap.onSubmit}>
        {onSubmitError =>
          typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
        }
      </form.Subscribe>

      <div className="flex items-center gap-2">
        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => (
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : lineId ? "Save changes" : "Add line"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
