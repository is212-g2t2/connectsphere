import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
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
import { IconAction } from "#/components/ui/icon-action";
import { Card, CardContent } from "#/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { formatProposedWindow } from "#/features/event-requests/format";
import { ConflictBadge } from "#/features/venue-requests/components/conflict-badge";
import { SessionRequirementFields } from "#/features/venue-requests/components/session-requirement-fields";
import { VenueRequestStatusBadge } from "#/features/venue-requests/components/venue-request-status-badge";
import {
  SESSION_REQUIREMENT_INPUTS,
  VENUE_REQUEST_STATUS_LABELS,
  createVenueRequestInput,
  formIssues,
  formatSessionSummary,
  sessionRequirementFormValues,
  sessionRequirementInput,
} from "#/features/venue-requests/schema";
import type {
  SessionRequirementFormValues,
  VenueRequestPrefill,
  VenueRequestStatus,
} from "#/features/venue-requests/schema";
import type { RoomLayout } from "#/features/venues/schema";
import { requestVenue, withdrawVenueRequest } from "#/features/venue-requests/server-fns";
import type {
  VenueRequestContext,
  VenueRequestContextRow,
} from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

/** Every input in panel order, so a refused submit can focus the first one it marked. */
const FIELDS = [
  "date",
  "startTime",
  "endTime",
  ...SESSION_REQUIREMENT_INPUTS.map(input => input.name),
] as const;

type FieldName = (typeof FIELDS)[number];

/** What the inputs hold. Field names match `VenueRequestInput`, so an issue lands on its field. */
interface RequestFormValues extends SessionRequirementFormValues {
  date: string;
  startTime: string;
  endTime: string;
  replacesRequestId: string;
}

/** The event fields that start the form: its window and its requirements. */
type PanelEvent = Omit<VenueRequestContext["event"], "id" | "name">;

/** Check that a carried window is complete and ordered, as `VenueRequestInput` requires. */
function hasCarriedWindow(prefill: VenueRequestPrefill): boolean {
  const { date, startTime, endTime } = prefill;
  return (
    date !== undefined && startTime !== undefined && endTime !== undefined && endTime > startTime
  );
}

/**
 * Fill the form from the carried values, else from the event. A complete carried window wins. A
 * carried date without times keeps its date. A request covers one civil day, so leave the times
 * empty for a multi-day event or another day, instead of silently truncating the window. Each
 * session requirement takes its carried value, else the event's requirement (PTR-138 AC1).
 * PTR-165 AC1: a carried request id marks the request that this one replaces.
 */
function toFormValues(event: PanelEvent, prefill: VenueRequestPrefill): RequestFormValues {
  const carried = hasCarriedWindow(prefill);
  const dateOnly = prefill.startTime === undefined && prefill.endTime === undefined;
  const date = (carried || dateOnly ? prefill.date : undefined) ?? event.eventDate ?? "";
  const eventTimes = event.endDate === event.eventDate && date === event.eventDate;
  return {
    date,
    startTime: carried ? (prefill.startTime ?? "") : eventTimes ? (event.startTime ?? "") : "",
    endTime: carried ? (prefill.endTime ?? "") : eventTimes ? (event.endTime ?? "") : "",
    replacesRequestId: prefill.replacesRequestId ?? "",
    ...sessionRequirementFormValues({
      expectedAttendance: prefill.expectedAttendance ?? event.expectedAttendance,
      layout: prefill.layout ?? event.layout,
      accessibilityRequirements:
        prefill.accessibilityRequirements ?? event.accessibilityRequirements,
      requiredFacilities: prefill.requiredFacilities ?? event.requiredFacilities,
    }),
  };
}

/** The server input for one submit: the panel's event and venue, the window, and the session. */
function toRequestInput(eventId: number, venueId: number, values: RequestFormValues) {
  return {
    eventId,
    venueId,
    date: values.date,
    startTime: values.startTime,
    endTime: values.endTime,
    // PTR-165 AC1: an empty choice means that this request replaces nothing.
    replacesRequestId: values.replacesRequestId || undefined,
    ...sessionRequirementInput(values),
  };
}

/** PTR-165 AC1: label one request that a new request can replace, for the form's picker. */
function replaceableLabel(row: VenueRequestContext["replaceable"][number]): string {
  const period = formatProposedWindow({ start: row.startsAt, end: row.endsAt });
  return `${VENUE_REQUEST_STATUS_LABELS[row.status]} — ${row.venueName}, ${period}`;
}

/**
 * What the confirmation says the button does, by the row's state. A pending request leaves the
 * Venue Staff queue. A rejected or released row no longer blocks confirmation (PTR-139, PTR-165);
 * a replacement request, a dismissal, or a withdrawal may already have cleared it.
 */
function withdrawDescription(
  status: VenueRequestStatus,
  venueName: string,
  period: string,
  answered: boolean
) {
  if (status === "pending") {
    return `This withdraws the booking request for ${venueName} on ${period}. Venue Staff will no longer see it in their queue.`;
  }
  const noun = status === "rejected" ? "request" : "booking";
  const outcome =
    status === "rejected"
      ? "you are no longer asking for that venue"
      : "you no longer hold that booking";
  const block = answered
    ? "It already does not block confirmation, so this only clears the row"
    : "It removes the block on confirmation";
  return `This withdraws the ${status} ${noun} for ${venueName} on ${period}, and ${outcome}. ${block}.`;
}

/**
 * PTR-31 criterion 5, PTR-139: let the Coordinator withdraw a pending request, or a rejected or
 * released one, after a confirmation that names the window. A pending withdrawal is destructive; a
 * rejected or released row is routine cleanup, so its trigger takes the neutral weight. Each row
 * keeps its own mutation, so an error stays in the dialog of the row that failed.
 */
function WithdrawRequestButton({
  requestId,
  status,
  answered,
  venueName,
  period,
}: {
  requestId: string;
  status: VenueRequestStatus;
  answered: boolean;
  venueName: string;
  period: string;
}) {
  const router = useRouter();
  const destructive = status === "pending";
  const [state, withdraw, withdrawing] = useMutation(async () => {
    await withdrawVenueRequest({ data: { id: requestId } });
    toast.success("Venue request withdrawn.");
    await router.invalidate({ filter: skipRootFilter });
  }, "Could not withdraw this request. Try again.");

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <IconAction
            label={`Withdraw request for ${period}`}
            icon={<Undo2 />}
            tone={destructive ? "danger" : undefined}
            className="w-fit"
          />
        }
      />
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw request</AlertDialogTitle>
          <AlertDialogDescription>
            {withdrawDescription(status, venueName, period, answered)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={withdrawing}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            size="sm"
            disabled={withdrawing}
            onClick={() => void withdraw()}
          >
            {withdrawing ? "Withdrawing…" : "Withdraw request"}
          </AlertDialogAction>
        </AlertDialogFooter>
        {state.status === "error" && (
          <p role="alert" className="body-sm text-destructive">
            {state.error}
          </p>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * What the caller can do with one row. Only the raiser can withdraw their own request: a pending
 * one, or a rejected or released one, which the event's current Coordinator can also withdraw
 * (PTR-139). Venue Staff release or amend an approved booking.
 */
function VenueRequestRowAction({
  row,
  venueName,
  period,
}: {
  row: VenueRequestContextRow;
  venueName: string;
  period: string;
}) {
  if (row.status === "approved") {
    return (
      <p className="body-sm text-muted-foreground">Booked. Venue Staff release or amend it.</p>
    );
  }
  if (row.canWithdraw) {
    return (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <WithdrawRequestButton
          requestId={row.id}
          status={row.status}
          answered={row.answered}
          venueName={venueName}
          period={period}
        />
        {row.status === "pending" ? (
          <p className="body-sm text-amber">
            Blocks confirmation until it is decided or withdrawn.
          </p>
        ) : (
          <p className={row.answered ? "body-sm text-muted-foreground" : "body-sm text-amber"}>
            {row.dismissed
              ? "Dismissed, so it does not block confirmation."
              : row.answered
                ? "Answered by a replacement request, so it does not block confirmation."
                : "Blocks confirmation until withdrawn, dismissed, or answered by a replacement request."}
          </p>
        )}
      </div>
    );
  }
  return (
    <p className="body-sm text-muted-foreground">
      Raised by another Coordinator, so only they can withdraw it.
    </p>
  );
}

/** PTR-139: the reason a rejected or released row ended, as the row shows it, else null. */
function rowOutcomeReason(row: VenueRequestContextRow): string | null {
  if (row.status === "rejected") {
    return row.rejectionReason ? `Rejection reason: ${row.rejectionReason}` : null;
  }
  if (row.status === "released") {
    return row.releaseReason ? `Release reason: ${row.releaseReason}` : null;
  }
  return null;
}

/**
 * One request of the event at this venue: its window, its state, and its action. The attendance
 * and layout tell two sessions at this venue apart (PTR-138 AC1). A pending row shows its conflict
 * flag, as the event card does. A rejected or released row shows why it ended (PTR-139).
 */
function VenueRequestRow({
  row,
  venueName,
  layouts,
}: {
  row: VenueRequestContextRow;
  venueName: string;
  layouts: readonly Pick<RoomLayout, "key" | "label">[];
}) {
  const period = formatProposedWindow({ start: row.startsAt, end: row.endsAt });
  const session = formatSessionSummary(row.requirements, layouts);
  const outcome = rowOutcomeReason(row);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="body-sm font-medium text-foreground">{period}</span>
          <VenueRequestStatusBadge status={row.status} />
          {row.conflict && <ConflictBadge conflict={row.conflict} />}
          {/* PTR-165 AC4: every reader sees that the Coordinator dismissed this row. */}
          {row.dismissed && <span className="body-sm text-muted-foreground">Dismissed</span>}
          {session && <span className="body-sm text-muted-foreground">{session}</span>}
        </div>
        {outcome && <p className="body-sm text-muted-foreground">{outcome}</p>}
      </div>
      <VenueRequestRowAction row={row} venueName={venueName} period={period} />
    </li>
  );
}

/**
 * PTR-31 and PTR-138 AC4: one card for the event the Coordinator came from. The top part lists the
 * event's pending requests and approved bookings at this venue. Below it, the request form stays
 * open while the caller can request, so the Coordinator can book another session at this venue.
 *
 * The route renders this panel only when the loader finds a context. Server middleware still
 * controls access.
 */
export function VenueRequestPanel({
  venueId,
  venueName,
  context,
  layouts,
  prefill = null,
}: {
  venueId: number;
  venueName: string;
  context: VenueRequestContext;
  /** The maintained list, from the route loader. The form refuses a typo against it; rows show it. */
  layouts: readonly Pick<RoomLayout, "key" | "label">[];
  prefill?: VenueRequestPrefill | null;
}) {
  const router = useRouter();
  const { event, requests, canRequest, replaceable } = context;
  const sameDay = event.endDate === event.eventDate;
  // The route creates a new `prefill` object on each render, so keep the first one. The venue page
  // keys the panel by the carried values, so other values mount a new panel.
  const [carriedValues] = useState<VenueRequestPrefill>(() => prefill ?? {});
  // A complete, ordered window came from the search or a rejected request (PTR-35).
  const carried = hasCarriedWindow(carriedValues);
  const inputRefs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});
  const listHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const formHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const form = useForm({
    defaultValues: toFormValues(event, carriedValues),
    // `VenueRequestInput` uses the server's rules. Mark each field with its first issue.
    validators: {
      onSubmit: ({ value }) =>
        formIssues(createVenueRequestInput(layouts), toRequestInput(event.id, venueId, value)),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await requestVenue({ data: toRequestInput(event.id, venueId, value) });
        toast.success("Venue request sent.");
        // PTR-165 AC1: the request that this one replaced is now answered, so it leaves the
        // picker. Clear the field, or the next submit would name a request that is already
        // replaced and be refused.
        formApi.setFieldValue("replacesRequestId", "");
        // The loader owns the list. Rerun it to add the new request above the form.
        await router.invalidate({ filter: skipRootFilter });
      } catch (error) {
        // `fields` marks this as a global error and stores `form` verbatim.
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error ? error.message : "Could not send this request. Try again.",
          },
        });
      }
    },
    // On submit failure, focus the first field the schema marked, in panel order.
    onSubmitInvalid: ({ formApi }) => {
      const firstInvalid = FIELDS.find(
        field => (formApi.state.fieldMeta[field]?.errors.length ?? 0) > 0
      );
      if (firstInvalid) inputRefs.current[firstInvalid]?.focus();
    },
  });

  // Reset the controls when the event's window or requirements change. Read plain values, not the
  // context object: every loader run makes a new object, and a withdrawal must not drop text the
  // Coordinator is typing. The venue page keys the panel by event, venue and carried values, so a
  // change to one of them mounts a new form.
  const {
    eventDate,
    endDate,
    startTime,
    endTime,
    expectedAttendance,
    layout,
    accessibilityRequirements,
    requiredFacilities,
  } = event;
  useEffect(() => {
    form.reset(
      toFormValues(
        {
          eventDate,
          endDate,
          startTime,
          endTime,
          expectedAttendance,
          layout,
          accessibilityRequirements,
          requiredFacilities,
        },
        // Keep the current replacement across the reset. The clear effect below drops it when the
        // event can no longer replace it.
        { ...carriedValues, replacesRequestId: form.state.values.replacesRequestId }
      )
    );
  }, [
    eventDate,
    endDate,
    startTime,
    endTime,
    expectedAttendance,
    layout,
    accessibilityRequirements,
    requiredFacilities,
    carriedValues,
    form,
  ]);

  // PTR-165 AC1: the picked replacement can stop being replaceable while the form holds it, for
  // example after a withdrawal reruns the loader. Clear it, so the select never shows one value
  // while the form submits another. Declare this after the reset, which restores the carried value.
  useEffect(() => {
    const chosen = form.state.values.replacesRequestId;
    if (chosen === "" || replaceable.some(row => row.id === chosen)) return;
    form.setFieldValue("replacesRequestId", "");
  }, [form, replaceable]);

  // A carried window comes from the search or the rejection card, and the form sits below the
  // venue record. Focus the form heading so the reader lands on the prefilled form.
  useEffect(() => {
    if (carried && canRequest) formHeadingRef.current?.focus();
  }, [carried, canRequest]);

  // Sending adds a row and withdrawing removes one. Move focus to the list heading so readers hear
  // the changed list. Do this only when the rows change but the event and venue stay the same.
  // Leave focus alone during venue navigation. The first run only records the current ids.
  const contextKey = `${event.id}:${venueId}`;
  const rowKey = requests.map(row => row.id).join(" ");
  const previous = useRef<{ contextKey: string; rowKey: string } | null>(null);
  useEffect(() => {
    const previousValue = previous.current;
    previous.current = { contextKey, rowKey };
    if (previousValue === null) return;
    if (previousValue.contextKey === contextKey && previousValue.rowKey !== rowKey) {
      listHeadingRef.current?.focus();
    }
  }, [contextKey, rowKey]);

  return (
    <section className="mt-8" aria-labelledby="venue-request-heading">
      <Card>
        <CardContent>
          <h2 id="venue-request-heading" ref={listHeadingRef} tabIndex={-1} className="display-h3">
            Requests for {event.name}
          </h2>
          {requests.length === 0 ? (
            <p className="mt-2 body-sm text-muted-foreground">
              This event has no pending request or booking at {venueName} yet.
            </p>
          ) : (
            <>
              <p className="mt-2 body-sm text-muted-foreground">
                Venue Staff decide pending requests from their queue.
                {!canRequest &&
                  " You can withdraw a request you raised, but you cannot raise a new one for this event."}
              </p>
              <ul aria-labelledby="venue-request-heading" className="mt-3 divide-y divide-border">
                {requests.map(row => (
                  <VenueRequestRow key={row.id} row={row} venueName={venueName} layouts={layouts} />
                ))}
              </ul>
            </>
          )}

          {canRequest && (
            <div className="mt-6 border-t border-border pt-6">
              <h3
                id="venue-request-form-heading"
                ref={formHeadingRef}
                tabIndex={-1}
                aria-describedby={carried ? "venue-request-context" : undefined}
                className="display-h3"
              >
                {requests.length === 0 ? "Request this venue" : "Request another time"}
              </h3>
              <p id="venue-request-context" className="mt-2 body-sm text-muted-foreground">
                Send Venue Staff a booking request for {venueName} on behalf of {event.name}.
                {carried &&
                  " The date and times below were carried over from the search or the rejected request. Change them if needed."}
              </p>
              {!sameDay && (
                <p className="mt-2 body-sm text-muted-foreground">
                  This event spans more than one day, so choose the date and times this request
                  covers.
                </p>
              )}
              <form
                noValidate
                aria-labelledby="venue-request-form-heading"
                className="mt-5 space-y-4"
                onSubmit={submitEvent => {
                  submitEvent.preventDefault();
                  // The library has no re-entrancy check. A second click can arrive before React disables the button.
                  if (form.state.isSubmitting) return;
                  void form.handleSubmit();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <form.Field name="date">
                    {field => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor="venue-request-date">Date</FieldLabel>
                        <Input
                          id="venue-request-date"
                          ref={element => {
                            inputRefs.current.date = element;
                          }}
                          type="date"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={changeEvent => field.handleChange(changeEvent.target.value)}
                          aria-invalid={field.state.meta.errors.length > 0}
                          required
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="startTime">
                    {field => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor="venue-request-start">Start time</FieldLabel>
                        <Input
                          id="venue-request-start"
                          ref={element => {
                            inputRefs.current.startTime = element;
                          }}
                          type="time"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={changeEvent => field.handleChange(changeEvent.target.value)}
                          aria-invalid={field.state.meta.errors.length > 0}
                          required
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="endTime">
                    {field => (
                      <Field data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor="venue-request-end">End time</FieldLabel>
                        <Input
                          id="venue-request-end"
                          ref={element => {
                            inputRefs.current.endTime = element;
                          }}
                          type="time"
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={changeEvent => field.handleChange(changeEvent.target.value)}
                          aria-invalid={field.state.meta.errors.length > 0}
                          required
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                </div>
                {/* PTR-165 AC1: mark the settled request, or the booking about to be released,
                    that this request replaces. */}
                {replaceable.length > 0 && (
                  <form.Field name="replacesRequestId">
                    {field => (
                      <Field>
                        <FieldLabel htmlFor="venue-request-replaces">
                          Replaces (optional)
                        </FieldLabel>
                        <Select
                          value={field.state.value === "" ? null : field.state.value}
                          onValueChange={value => field.handleChange(value ?? "")}
                        >
                          <SelectTrigger
                            id="venue-request-replaces"
                            className="w-full"
                            aria-describedby="venue-request-replaces-hint"
                            onBlur={field.handleBlur}
                          >
                            <SelectValue>
                              {(value: string | null) => {
                                const selected = replaceable.find(row => row.id === value);
                                return selected ? replaceableLabel(selected) : "No replacement";
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={null}>No replacement</SelectItem>
                            {replaceable.map(row => (
                              <SelectItem key={row.id} value={row.id}>
                                {replaceableLabel(row)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FieldDescription id="venue-request-replaces-hint">
                          Choose the rejected or released request, or the booking you are about to
                          release, that this request replaces.
                        </FieldDescription>
                      </Field>
                    )}
                  </form.Field>
                )}
                {/* PTR-138 AC1: the venue must meet this session's requirements. */}
                <FieldSet aria-describedby="venue-request-session-hint">
                  <FieldLegend variant="label">Session requirements</FieldLegend>
                  <FieldDescription id="venue-request-session-hint">
                    These start from the event&apos;s requirements, and the venue must meet them. A
                    blank attendance uses the event&apos;s figure.
                  </FieldDescription>
                  <SessionRequirementFields
                    form={form}
                    idPrefix="venue-request"
                    layouts={layouts}
                    inputRef={(name, element) => {
                      inputRefs.current[name] = element;
                    }}
                  />
                </FieldSet>
                <form.Subscribe selector={state => state.isSubmitting}>
                  {isSubmitting => (
                    <Button type="submit" className="w-fit" disabled={isSubmitting}>
                      {isSubmitting ? "Sending…" : "Send booking request"}
                    </Button>
                  )}
                </form.Subscribe>
                <form.Subscribe selector={state => state.errorMap.onSubmit}>
                  {onSubmitError =>
                    typeof onSubmitError === "string" ? (
                      <FieldError>{onSubmitError}</FieldError>
                    ) : null
                  }
                </form.Subscribe>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
