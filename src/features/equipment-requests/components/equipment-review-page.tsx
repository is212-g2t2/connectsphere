import { useForm } from "@tanstack/react-form";
import { Link, useRouter } from "@tanstack/react-router";
import { CalendarDays, Clock3 } from "lucide-react";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select";
import { Textarea } from "#/components/ui/textarea";
import {
  ARRANGEMENT_RESERVED_MESSAGE,
  ARRANGEMENT_STATE_LABELS,
  ARRANGEMENT_STATES,
  ArrangementFormInput,
} from "#/features/equipment-requests/schema";
import { updateEquipmentArrangement } from "#/features/equipment-requests/server-fns";
import { formatLocalDate } from "#/features/event-requests/format";
import type { EquipmentLineProjection, EventProjection } from "#/features/events/access";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * PTR-39 AC2 and AC3: one submitted equipment request. `event` is the Technical Support
 * projection of the event, so the event, its date and times and every line arrive together; each
 * line has its own form, and the Coordinator sees what is saved here the next time they load
 * the event.
 */
export function EquipmentReviewPage({ event }: { event: EventProjection["event"] }) {
  const lines = event.equipment ?? [];
  return (
    <Page width="page">
      <Link to="/equipment-requests" className={NAV_LINK_CLASSNAME}>
        Back to work list
      </Link>
      <PageHeader
        eyebrow="Technical Support"
        title={event.name ?? "Equipment request"}
        description={
          <span className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {event.eventDate && (
              <span className="flex items-center gap-2">
                <CalendarDays className="size-4" aria-hidden="true" />
                <span>{formatLocalDate(event.eventDate)}</span>
              </span>
            )}
            {event.startTime && event.endTime && (
              <span className="flex items-center gap-2">
                <Clock3 className="size-4" aria-hidden="true" />
                <span>{`${event.startTime}–${event.endTime}`}</span>
              </span>
            )}
          </span>
        }
      />

      <section aria-labelledby="equipment-lines-heading">
        <h2 id="equipment-lines-heading" className="display-h3">
          Equipment lines
        </h2>
        {lines.length === 0 ? (
          <p className="mt-4 body-sm text-muted-foreground">No equipment lines recorded.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {lines.map(line => (
              <ArrangementLine key={line.id} eventId={event.id} line={line} />
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

/**
 * One line: what was asked for, then either its form or, for a line another member of Technical
 * Support is arranging, where that stands. `arrangeable` is absent when the server did not say, so
 * only an explicit `false` takes the form away.
 */
function ArrangementLine({ eventId, line }: { eventId: number; line: EquipmentLineProjection }) {
  return (
    <li aria-label={line.item} className="rounded-lg border border-border p-4">
      <p className="font-medium">
        {line.item} <span className="text-muted-foreground">× {line.quantity}</span>
      </p>
      {line.notes && <p className="mt-1 body-sm text-muted-foreground">{line.notes}</p>}

      {line.arrangeable === false ? (
        <div className="mt-4 space-y-1 body-sm">
          <p className="text-muted-foreground">
            Being arranged by another member of Technical Support.
          </p>
          <p className="font-medium">
            {ARRANGEMENT_STATE_LABELS[line.arrangementStatus] ?? line.arrangementStatus}
          </p>
          {line.unavailableReason && (
            <p className="text-muted-foreground">{`Reason: ${line.unavailableReason}`}</p>
          )}
          {line.arrangementNotes && (
            <p className="text-muted-foreground">
              {`Technical Support note: ${line.arrangementNotes}`}
            </p>
          )}
        </div>
      ) : (
        <ArrangementForm eventId={eventId} line={line} />
      )}
    </li>
  );
}

/**
 * A line's form. A line holding a reservation shows its state but cannot change it, and leaves
 * the state out of the update so only its notes are sent.
 */
function ArrangementForm({ eventId, line }: { eventId: number; line: EquipmentLineProjection }) {
  const router = useRouter();
  const locked = line.arrangementStatus === "reserved";
  const fieldId = (name: string) => `arrangement-${name}-${line.id}`;

  const form = useForm({
    defaultValues: {
      arrangementStatus: line.arrangementStatus,
      unavailableReason: line.unavailableReason ?? "",
      arrangementNotes: line.arrangementNotes ?? "",
    },
    validators: { onSubmit: ArrangementFormInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await updateEquipmentArrangement({
          data: {
            eventId,
            id: line.id,
            ...(locked ? {} : { arrangementStatus: value.arrangementStatus }),
            ...(!locked && value.arrangementStatus === "unavailable"
              ? { unavailableReason: value.unavailableReason }
              : {}),
            arrangementNotes: value.arrangementNotes,
          },
        });
        toast.success("Equipment line updated.");
        await router.invalidate();
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
      className="mt-4 space-y-3"
      onSubmit={e => {
        e.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Field name="arrangementStatus">
        {field => (
          <Field>
            <FieldLabel htmlFor={fieldId("state")}>
              {`Arrangement state for ${line.item}`}
            </FieldLabel>
            <NativeSelect
              id={fieldId("state")}
              value={field.state.value}
              disabled={locked}
              onChange={e => field.handleChange(e.target.value)}
            >
              {locked ? (
                <NativeSelectOption value="reserved">
                  {ARRANGEMENT_STATE_LABELS.reserved}
                </NativeSelectOption>
              ) : (
                ARRANGEMENT_STATES.map(state => (
                  <NativeSelectOption key={state} value={state}>
                    {ARRANGEMENT_STATE_LABELS[state]}
                  </NativeSelectOption>
                ))
              )}
            </NativeSelect>
            {locked && (
              <p className="body-sm text-muted-foreground">{ARRANGEMENT_RESERVED_MESSAGE}</p>
            )}
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={state => state.values.arrangementStatus}>
        {status =>
          status === "unavailable" && (
            <form.Field name="unavailableReason">
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor={fieldId("reason")}>
                    {`Reason unavailable for ${line.item} (required)`}
                  </FieldLabel>
                  <Textarea
                    id={fieldId("reason")}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={e => field.handleChange(e.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                    rows={2}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          )
        }
      </form.Subscribe>

      <form.Field name="arrangementNotes">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={fieldId("notes")}>
              {`Technical Support notes for ${line.item}`}
            </FieldLabel>
            <Textarea
              id={fieldId("notes")}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={e => field.handleChange(e.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              placeholder="Where the equipment is held, what was arranged"
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

      <form.Subscribe selector={state => state.isSubmitting}>
        {isSubmitting => (
          <Button type="submit" size="sm" disabled={isSubmitting} aria-label={`Save ${line.item}`}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
