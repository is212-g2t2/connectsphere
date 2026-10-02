import { useForm } from "@tanstack/react-form";
import { Link, useRouter } from "@tanstack/react-router";
import { CalendarDays, Clock3 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { availabilityMessage } from "#/features/equipment-requests/availability";
import { ArrangementPosition } from "#/features/equipment-requests/components/arrangement-position";
import { LastReleaseNote } from "#/features/equipment-requests/components/last-release-note";
import { ReleaseEquipmentAction } from "#/features/equipment-requests/components/release-equipment-action";
import { ReserveEquipmentAction } from "#/features/equipment-requests/components/reserve-equipment-action";
import { ReservedCount } from "#/features/equipment-requests/components/reserved-count";
import {
  ARRANGEMENT_EMPTY_UPDATE_MESSAGE,
  ARRANGEMENT_RESERVED_MESSAGE,
  ARRANGEMENT_STATES,
  ArrangementFormInput,
  AvailabilityCheckFormInput,
  arrangementStateLabel,
  canGiveBackUnits,
} from "#/features/equipment-requests/schema";
import {
  checkEquipmentAvailability,
  completeEquipmentArrangements,
  recordEquipmentUnavailable,
  updateEquipmentArrangement,
} from "#/features/equipment-requests/server-fns";
import { formatLocalDate, formatLocalDateTime } from "#/features/event-requests/format";
import { parseWholeNumber } from "#/features/event-requests/schema";
import type { EquipmentLineProjection, EventProjection } from "#/features/events/access";
import { useMutation } from "#/hooks/use-mutation";
import { NAV_LINK_CLASSNAME } from "#/lib/utils";

/**
 * PTR-39 AC2 and AC3: one submitted equipment request. `event` is the Technical Support
 * projection of the event, so the event, its date and times and every line arrive together; each
 * line has its own form, and the Coordinator sees what is saved here the next time they load
 * the event.
 */
export function EquipmentReviewPage({
  event,
  access,
  equipmentTypes,
}: {
  event: EventProjection["event"];
  access: EventProjection["access"];
  equipmentTypes: { id: number; name: string }[] | null;
}) {
  const lines = event.equipment ?? [];
  const router = useRouter();
  const [completion, markComplete, completing] = useMutation(async () => {
    await completeEquipmentArrangements({ data: { eventId: event.id } });
    toast.success("Technical arrangements marked complete.");
    await router.invalidate();
  }, "Could not mark arrangements complete. Try again.");

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

      {access === "technical_support" && lines.length > 0 && (
        <section aria-labelledby="arrangements-completion-heading" className="mt-8">
          <h2 id="arrangements-completion-heading" className="display-h3">
            Technical arrangements
          </h2>
          {event.equipmentArrangementsCompletedAt ? (
            <output className="mt-3 block body-sm">Technical arrangements complete.</output>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="body-sm text-muted-foreground">
                Every line must be reserved or marked not required before arrangements can be
                completed.
              </p>
              {completion.status === "error" && (
                <p role="alert" className="mt-3 body-sm text-destructive">
                  {completion.error}
                </p>
              )}
              <Button onClick={() => void markComplete()} disabled={completing}>
                {completing ? "Marking complete…" : "Mark arrangements complete"}
              </Button>
            </div>
          )}
        </section>
      )}

      <AvailabilityCheck eventId={event.id} equipmentTypes={equipmentTypes} />
    </Page>
  );
}

/**
 * PTR-40: how much of an equipment type is free for the event's approved venue booking. The
 * wording comes from `availabilityMessage`; the server refuses an event with no approved booking.
 */
function AvailabilityCheck({
  eventId,
  equipmentTypes,
}: {
  eventId: number;
  equipmentTypes: { id: number; name: string }[] | null;
}) {
  // The server's answer, which is not a form value; TanStack Form owns the inputs and errors.
  const [outcome, setOutcome] = useState<{ message: string; shortfall: number } | null>(null);

  const form = useForm({
    defaultValues: { equipmentTypeId: "", requestedQuantity: "" },
    validators: { onSubmit: AvailabilityCheckFormInput },
    onSubmit: async ({ value, formApi }) => {
      setOutcome(null);
      try {
        const result = await checkEquipmentAvailability({
          data: {
            eventId,
            equipmentTypeId: Number(value.equipmentTypeId),
            requestedQuantity:
              value.requestedQuantity === ""
                ? undefined
                : parseWholeNumber(value.requestedQuantity),
          },
        });
        const { startsAt, endsAt } = result.period;
        setOutcome({
          message: `${result.equipmentTypeName}: ${availabilityMessage(result)} (${formatLocalDateTime(startsAt)} to ${formatLocalDateTime(endsAt)})`,
          shortfall: result.shortfall,
        });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error ? error.message : "Could not check availability. Try again.",
          },
        });
      }
    },
  });

  if (equipmentTypes === null || equipmentTypes.length === 0) {
    return (
      <section aria-labelledby="availability-heading" className="mt-8">
        <h2 id="availability-heading" className="display-h3">
          Check availability
        </h2>
        <p className="body-sm text-muted-foreground">
          {equipmentTypes === null
            ? "Could not load equipment types."
            : "No equipment types are available."}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="availability-heading" className="mt-8">
      <h2 id="availability-heading" className="display-h3">
        Check availability
      </h2>
      <form
        noValidate
        className="mt-3 space-y-3"
        onSubmit={e => {
          e.preventDefault();
          if (form.state.isSubmitting) return;
          void form.handleSubmit();
        }}
      >
        <form.Field name="equipmentTypeId">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor="availability-type">Equipment type</FieldLabel>
              <Select
                value={field.state.value || null}
                onValueChange={value => {
                  setOutcome(null);
                  field.handleChange(value ?? "");
                }}
              >
                <SelectTrigger
                  id="availability-type"
                  className="w-full"
                  aria-invalid={field.state.meta.errors.length > 0}
                  onBlur={field.handleBlur}
                >
                  <SelectValue placeholder="Choose an equipment type">
                    {field.state.value === ""
                      ? null
                      : (value: string) => equipmentTypes.find(t => String(t.id) === value)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {equipmentTypes.map(type => (
                    <SelectItem key={type.id} value={String(type.id)}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="requestedQuantity">
          {field => (
            <Field data-invalid={field.state.meta.errors.length > 0}>
              <FieldLabel htmlFor="availability-quantity">Quantity (optional)</FieldLabel>
              <Input
                id="availability-quantity"
                type="number"
                min={1}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={e => {
                  setOutcome(null);
                  field.handleChange(e.target.value);
                }}
                aria-invalid={field.state.meta.errors.length > 0}
              />
              <FieldDescription>Leave blank to see total free.</FieldDescription>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={state => state.errorMap.onSubmit}>
          {onSubmitError =>
            typeof onSubmitError === "string" ? <FieldError>{onSubmitError}</FieldError> : null
          }
        </form.Subscribe>
        {outcome && (
          <output className={outcome.shortfall > 0 ? "body-sm font-medium" : "body-sm"}>
            {outcome.message}
          </output>
        )}

        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => (
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? "Checking…" : "Check availability"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}

/**
 * One line: what was asked for, then either its form or, for a line another member of Technical
 * Support is arranging, where that stands. `arrangeable` is absent when the server did not say, so
 * only an explicit `false` takes the form away.
 */
function ArrangementLine({ eventId, line }: { eventId: number; line: EquipmentLineProjection }) {
  const canReserve =
    line.arrangeable !== false &&
    (line.arrangementStatus === "requested" || line.arrangementStatus === "reserved");
  // PTR-42: only units already held can be given back.
  const canRelease = canGiveBackUnits(line);
  return (
    <li aria-label={line.item} className="rounded-lg border border-border p-4">
      <h3 className="font-medium">
        {line.item} <span className="text-muted-foreground">× {line.quantity}</span>
        {typeof line.reservedQuantity === "number" && (
          <ReservedCount quantity={line.reservedQuantity} className="text-muted-foreground" />
        )}
      </h3>
      {line.notes && <p className="mt-1 body-sm text-muted-foreground">{line.notes}</p>}
      {line.lastRelease && (
        <div className="mt-1">
          <LastReleaseNote release={line.lastRelease} />
        </div>
      )}

      {line.arrangeable === false ? (
        <div className="mt-4 body-sm">
          <p className="text-muted-foreground">
            {`Being arranged by ${line.assignedStaffName ?? "another member of Technical Support"}`}
          </p>
          <ArrangementPosition line={line} />
        </div>
      ) : (
        <>
          {line.assignedStaffName && (
            <p className="mt-4 body-sm text-muted-foreground">You are arranging this line.</p>
          )}
          {(canReserve || canRelease) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {canReserve && <ReserveEquipmentAction line={line} />}
              {canRelease && <ReleaseEquipmentAction line={line} />}
            </div>
          )}
          <ArrangementForm eventId={eventId} line={line} />
        </>
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
  const locked = line.arrangementStatus === "reserved" || (line.reservedQuantity ?? 0) > 0;
  const fieldId = (name: string) => `arrangement-${name}-${line.id}`;

  const form = useForm({
    defaultValues: {
      arrangementStatus: line.arrangementStatus,
      unavailableReason: line.unavailableReason ?? "",
      arrangementNotes: line.arrangementNotes ?? "",
    },
    validators: { onSubmit: ArrangementFormInput },
    onSubmit: async ({ value, formApi }) => {
      // Send only what the member changed: another tab may have moved the rest since this loaded.
      // A reason travels with its status (the server writes it only alongside one), so a reason
      // edit on an `unavailable` line resends its status.
      const stateChanged =
        !locked &&
        (value.arrangementStatus !== line.arrangementStatus ||
          (value.arrangementStatus === "unavailable" &&
            value.unavailableReason !== (line.unavailableReason ?? "")));
      const notesChanged = value.arrangementNotes !== (line.arrangementNotes ?? "");
      if (!stateChanged && !notesChanged) {
        formApi.setErrorMap({
          onSubmit: { fields: {}, form: ARRANGEMENT_EMPTY_UPDATE_MESSAGE },
        });
        return;
      }
      try {
        if (stateChanged && value.arrangementStatus === "unavailable") {
          await recordEquipmentUnavailable({
            data: {
              eventId,
              id: line.id,
              reason: value.unavailableReason,
              ...(notesChanged ? { arrangementNotes: value.arrangementNotes } : {}),
            },
          });
        } else {
          await updateEquipmentArrangement({
            data: {
              eventId,
              id: line.id,
              ...(stateChanged ? { arrangementStatus: value.arrangementStatus } : {}),
              ...(notesChanged ? { arrangementNotes: value.arrangementNotes } : {}),
            },
          });
        }
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
            <Select
              value={field.state.value}
              disabled={locked}
              onValueChange={value => field.handleChange(value ?? line.arrangementStatus)}
            >
              <SelectTrigger
                id={fieldId("state")}
                className="w-full"
                aria-describedby={locked ? fieldId("reserved") : undefined}
                onBlur={field.handleBlur}
              >
                <SelectValue>{(value: string) => arrangementStateLabel(value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(locked ? [line.arrangementStatus] : ARRANGEMENT_STATES).map(state => (
                  <SelectItem key={state} value={state}>
                    {arrangementStateLabel(state)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {locked && (
              <p id={fieldId("reserved")} className="body-sm text-muted-foreground">
                {ARRANGEMENT_RESERVED_MESSAGE}
              </p>
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
