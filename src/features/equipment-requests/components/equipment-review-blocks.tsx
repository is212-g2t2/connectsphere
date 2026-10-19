import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

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
import { BookingSelect } from "#/features/equipment-requests/components/booking-select";
import type { EquipmentBookingOption } from "#/features/equipment-requests/schema";
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
  mapEquipmentLine,
  recordEquipmentUnavailable,
  updateEquipmentArrangement,
} from "#/features/equipment-requests/server-fns";
import { formatProposedWindow } from "#/features/event-requests/format";
import type { EquipmentTypeOption } from "#/features/events/page-data";
import { parseWholeNumber } from "#/features/event-requests/schema";
import type { EquipmentLineProjection } from "#/features/events/access";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

/** Show the review page's line, completion, and availability sections. The host provides the headings. */
export function ArrangementLines({
  eventId,
  lines,
  bookings,
  equipmentTypes = null,
}: {
  eventId: number;
  lines: EquipmentLineProjection[];
  bookings: EquipmentBookingOption[];
  equipmentTypes?: EquipmentTypeOption[] | null;
}) {
  if (lines.length === 0) {
    return <p className="body-sm text-muted-foreground">No equipment lines recorded.</p>;
  }
  return (
    <ul className="space-y-4">
      {lines.map(line => (
        <ArrangementLine
          key={line.id}
          eventId={eventId}
          line={line}
          bookings={bookings}
          equipmentTypes={equipmentTypes}
        />
      ))}
    </ul>
  );
}

export function ArrangementsCompletion({
  eventId,
  completedAt,
}: {
  eventId: number;
  completedAt: string | null;
}) {
  const router = useRouter();
  const [completion, markComplete, completing] = useMutation(async () => {
    await completeEquipmentArrangements({ data: { eventId } });
    toast.success("Technical arrangements marked complete.");
    await router.invalidate({ filter: skipRootFilter });
  }, "Could not mark arrangements complete. Try again.");

  if (completedAt) {
    return <output className="block body-sm">Technical arrangements complete.</output>;
  }
  return (
    <div className="space-y-3">
      <p className="body-sm text-muted-foreground">
        Every line must be reserved or marked not required before arrangements can be completed.
      </p>
      {completion.status === "error" && (
        <p role="alert" className="body-sm text-destructive">
          {completion.error}
        </p>
      )}
      <Button onClick={() => void markComplete()} disabled={completing}>
        {completing ? "Marking complete…" : "Mark arrangements complete"}
      </Button>
    </div>
  );
}

/** PTR-40: Check availability for an approved booking. Use `availabilityMessage` for the result. The server refuses events with no approved booking. */
export function AvailabilityCheck({
  eventId,
  equipmentTypes,
  bookings,
}: {
  eventId: number;
  equipmentTypes: EquipmentTypeOption[] | null;
  bookings: EquipmentBookingOption[];
}) {
  const [venueRequestId, setVenueRequestId] = useState(bookings.length === 1 ? bookings[0].id : "");
  // Store the server's answer outside the form. TanStack Form owns the inputs and errors.
  const [outcome, setOutcome] = useState<{ message: string; shortfall: number } | null>(null);
  const requestVersion = useRef(0);
  // Drop a stale answer when the next check starts from new inputs.
  const resetOutcome = () => {
    requestVersion.current++;
    setOutcome(null);
  };

  const form = useForm({
    defaultValues: { equipmentTypeId: "", requestedQuantity: "" },
    validators: { onSubmit: AvailabilityCheckFormInput },
    onSubmit: async ({ value, formApi }) => {
      const version = ++requestVersion.current;
      setOutcome(null);
      try {
        const result = await checkEquipmentAvailability({
          data: {
            eventId,
            venueRequestId: venueRequestId || undefined,
            equipmentTypeId: Number(value.equipmentTypeId),
            requestedQuantity:
              value.requestedQuantity === ""
                ? undefined
                : parseWholeNumber(value.requestedQuantity),
          },
        });
        if (version !== requestVersion.current) return;
        const { startsAt, endsAt } = result.period;
        setOutcome({
          message: `${result.equipmentTypeName}: ${availabilityMessage(result)} (${formatProposedWindow({ start: startsAt, end: endsAt })})`,
          shortfall: result.shortfall,
        });
      } catch (error) {
        if (version !== requestVersion.current) return;
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
      <p className="body-sm text-muted-foreground">
        {equipmentTypes === null
          ? "Could not load equipment types."
          : "No equipment types are available."}
      </p>
    );
  }

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={e => {
        e.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      {venueRequestId === "" && bookings.length > 0 && (
        <p id="availability-booking-help" className="body-sm text-muted-foreground">
          Choose a booking to check availability.
        </p>
      )}
      <BookingSelect
        id="availability-booking"
        bookings={bookings}
        value={venueRequestId}
        describedBy={
          venueRequestId === "" && bookings.length > 0 ? "availability-booking-help" : undefined
        }
        onChange={value => {
          resetOutcome();
          setVenueRequestId(value);
        }}
      />
      <form.Field name="equipmentTypeId">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor="availability-type">Equipment type</FieldLabel>
            <Select
              value={field.state.value || null}
              onValueChange={value => {
                resetOutcome();
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
                resetOutcome();
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
          <Button type="submit" size="sm" disabled={isSubmitting || !venueRequestId}>
            {isSubmitting ? "Checking…" : "Check availability"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

/** Show the requested item and its form. Show its state if another Technical Support member arranges it. Hide the form only when `arrangeable` is false. Keep the form when the server omits `arrangeable`. */
function ArrangementLine({
  eventId,
  line,
  bookings,
  equipmentTypes,
}: {
  eventId: number;
  line: EquipmentLineProjection;
  bookings: EquipmentBookingOption[];
  equipmentTypes?: EquipmentTypeOption[] | null;
}) {
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
      {line.windowChanged && line.arrangeable !== false && (
        <p className="mt-1 body-sm font-medium">Window changed</p>
      )}
      {(line.shortfall ?? 0) > 0 && line.arrangeable !== false && (
        <p className="mt-1 body-sm font-medium">Short by {line.shortfall}</p>
      )}
      {line.notes && <p className="mt-1 body-sm text-muted-foreground">{line.notes}</p>}
      {line.lastRelease && (
        <div className="mt-1">
          <LastReleaseNote release={line.lastRelease} />
        </div>
      )}
      {(line.equipmentTypeId ?? null) === null && line.arrangeable !== false && (
        <MapLineToType eventId={eventId} line={line} equipmentTypes={equipmentTypes} />
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
              {canReserve && <ReserveEquipmentAction line={line} bookings={bookings} />}
              {canRelease && <ReleaseEquipmentAction line={line} />}
            </div>
          )}
          <ArrangementForm eventId={eventId} line={line} />
        </>
      )}
    </li>
  );
}

/** PTR-162 AC5: map a free-text line to a catalogue type so reserve works. */
function MapLineToType({
  eventId,
  line,
  equipmentTypes,
}: {
  eventId: number;
  line: EquipmentLineProjection;
  equipmentTypes?: EquipmentTypeOption[] | null;
}) {
  const router = useRouter();
  const [typeId, setTypeId] = useState("");
  const [mapping, map, mappingInFlight] = useMutation(async () => {
    await mapEquipmentLine({
      data: { eventId, id: line.id, equipmentTypeId: Number(typeId) },
    });
    toast.success("Equipment line mapped to type.");
    await router.invalidate({ filter: skipRootFilter });
  }, "Could not map this line. Try again.");

  if (equipmentTypes === null) {
    return <p className="mt-2 body-sm text-muted-foreground">Could not load equipment types.</p>;
  }
  if (!equipmentTypes || equipmentTypes.length === 0) {
    return (
      <p className="mt-2 body-sm text-muted-foreground">
        No catalogue type matches &ldquo;{line.item}&rdquo;. Add the type in the catalogue first.
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <Field>
          <FieldLabel htmlFor={`map-type-${line.id}`}>
            Map &ldquo;{line.item}&rdquo; to type
          </FieldLabel>
          <Select value={typeId || null} onValueChange={value => setTypeId(value ?? "")}>
            <SelectTrigger id={`map-type-${line.id}`} className="w-full">
              <SelectValue placeholder="Choose a type">
                {typeId === ""
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
        </Field>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={mappingInFlight || typeId === ""}
        onClick={() => void map()}
      >
        {mappingInFlight ? "Mapping…" : "Map to type"}
      </Button>
      {mapping.status === "error" && (
        <p role="alert" className="body-sm w-full text-destructive">
          {mapping.error}
        </p>
      )}
    </div>
  );
}

/** Show the line's form. A reserved line shows its state but sends only note changes. */
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
      // Send only changed fields because another tab may have changed the rest.
      // Send the status with its reason. A reason edit on an `unavailable` line must resend that status.
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
        await router.invalidate({ filter: skipRootFilter });
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
