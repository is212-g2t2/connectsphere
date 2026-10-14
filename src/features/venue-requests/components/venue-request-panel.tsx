import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
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
import { formatProposedWindow } from "#/features/event-requests/format";
import { VenueRequestStatusBadge } from "#/features/venue-requests/components/venue-request-status-badge";
import {
  SESSION_REQUIREMENT_INPUTS,
  VenueRequestInput,
  formatSessionSummary,
  sessionRequirementFormValues,
  sessionRequirementInput,
} from "#/features/venue-requests/schema";
import type {
  SessionRequirementFormValues,
  VenueRequestPrefill,
} from "#/features/venue-requests/schema";
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
    ...sessionRequirementFormValues({
      expectedAttendance: prefill.expectedAttendance ?? event.expectedAttendance,
      layout: prefill.layout ?? event.layout,
      accessibility: prefill.accessibility ?? event.accessibilityRequirements,
      facilities: prefill.facilities ?? event.requiredFacilities,
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
    ...sessionRequirementInput(values),
  };
}

/**
 * PTR-31 criterion 5: let the Coordinator who raised a pending request withdraw it, after a
 * confirmation that names the window. Each row keeps its own mutation, so an error stays in the
 * dialog of the row that failed.
 */
function WithdrawRequestButton({
  requestId,
  venueName,
  period,
}: {
  requestId: string;
  venueName: string;
  period: string;
}) {
  const router = useRouter();
  const [state, withdraw, withdrawing] = useMutation(async () => {
    await withdrawVenueRequest({ data: { id: requestId } });
    toast.success("Venue request withdrawn.");
    await router.invalidate({ filter: skipRootFilter });
  }, "Could not withdraw this request. Try again.");

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="destructive"
            size="sm"
            className="w-fit"
            aria-label={`Withdraw request for ${period}`}
          />
        }
      >
        Withdraw request
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw request</AlertDialogTitle>
          <AlertDialogDescription>
            This withdraws the booking request for {venueName} on {period}. Venue Staff will no
            longer see it in their queue.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={withdrawing}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            size="sm"
            disabled={withdrawing}
            onClick={() => void withdraw()}
          >
            {withdrawing ? "Withdrawing…" : "Confirm"}
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
 * What the caller can do with one row. Only the raiser can withdraw a pending request. Venue Staff
 * release or amend an approved booking.
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
    return <WithdrawRequestButton requestId={row.id} venueName={venueName} period={period} />;
  }
  return (
    <p className="body-sm text-muted-foreground">
      Raised by another Coordinator, so only they can withdraw it.
    </p>
  );
}

/**
 * One request of the event at this venue: its window, its state, and its action. The attendance
 * and layout tell two sessions at this venue apart (PTR-138 AC1).
 */
function VenueRequestRow({ row, venueName }: { row: VenueRequestContextRow; venueName: string }) {
  const period = formatProposedWindow({ start: row.startsAt, end: row.endsAt });
  const session = formatSessionSummary(row.requirements);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="body-sm font-medium text-foreground">{period}</span>
        <VenueRequestStatusBadge status={row.status} />
        {session && <span className="body-sm text-muted-foreground">{session}</span>}
      </div>
      <VenueRequestRowAction row={row} venueName={venueName} period={period} />
    </li>
  );
}

/**
 * PTR-31 and PTR-138 AC4: one card for the event the Coordinator came from. The top part lists the
 * event's pending requests and approved bookings at this venue. Below it, the request form stays
 * open while the caller can request, so the Coordinator can book another session at this venue.
 * The route renders this panel only when the loader finds a context. Server middleware still
 * controls access.
 */
export function VenueRequestPanel({
  venueId,
  venueName,
  context,
  prefill = null,
}: {
  venueId: number;
  venueName: string;
  context: VenueRequestContext;
  prefill?: VenueRequestPrefill | null;
}) {
  const router = useRouter();
  const { event, requests, canRequest } = context;
  const sameDay = event.endDate === event.eventDate;
  // The route creates a new `prefill` object on each render. Compare values so a render does not
  // reset what the Coordinator is typing.
  const {
    date: prefillDate,
    startTime: prefillStart,
    endTime: prefillEnd,
    expectedAttendance: prefillAttendance,
    layout: prefillLayout,
    accessibility: prefillAccessibility,
    facilities: prefillFacilities,
  } = prefill ?? {};
  const stablePrefill = useMemo<VenueRequestPrefill>(
    () => ({
      date: prefillDate,
      startTime: prefillStart,
      endTime: prefillEnd,
      expectedAttendance: prefillAttendance,
      layout: prefillLayout,
      accessibility: prefillAccessibility,
      facilities: prefillFacilities,
    }),
    [
      prefillDate,
      prefillStart,
      prefillEnd,
      prefillAttendance,
      prefillLayout,
      prefillAccessibility,
      prefillFacilities,
    ]
  );
  // A complete, ordered window came from the search or a rejected request (PTR-35).
  const carried = hasCarriedWindow(stablePrefill);
  const inputRefs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});
  const listHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const formHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const form = useForm({
    defaultValues: toFormValues(event, stablePrefill),
    // `VenueRequestInput` uses the server's rules. Validate the request once, then mark each field
    // with its first issue, as `reject-booking-form.tsx` does.
    validators: {
      onSubmit: ({ value }) => {
        const parsed = VenueRequestInput.safeParse(toRequestInput(event.id, venueId, value));
        if (parsed.success) return undefined;
        const fields: Record<string, { message: string }> = {};
        for (const issue of parsed.error.issues) {
          fields[String(issue.path[0])] ??= { message: issue.message };
        }
        return { fields };
      },
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await requestVenue({ data: toRequestInput(event.id, venueId, value) });
        toast.success("Venue request sent.");
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

  // Reset the controls when the event's window or requirements or the carried values change. Read
  // plain values, not the context object: every loader run makes a new object, and a withdrawal
  // must not drop text the Coordinator is typing. The venue page keys the panel by event and
  // venue, so another event or venue mounts a new form.
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
        stablePrefill
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
    stablePrefill,
    form,
  ]);

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
                  <VenueRequestRow key={row.id} row={row} venueName={venueName} />
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
                        <FieldLabel htmlFor="venue-request-date">Date (required)</FieldLabel>
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
                        <FieldLabel htmlFor="venue-request-start">Start time (required)</FieldLabel>
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
                        <FieldLabel htmlFor="venue-request-end">End time (required)</FieldLabel>
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
                {/* PTR-138 AC1: the venue must meet this session's requirements. */}
                <FieldSet>
                  <FieldLegend variant="label">Session requirements</FieldLegend>
                  <FieldDescription id="venue-request-session-hint">
                    These start from the event&apos;s requirements, and the venue must meet them. A
                    blank attendance uses the event&apos;s figure.
                  </FieldDescription>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {SESSION_REQUIREMENT_INPUTS.map(({ name, label, type, placeholder }) => (
                      <form.Field key={name} name={name}>
                        {field => (
                          <Field data-invalid={field.state.meta.errors.length > 0}>
                            <FieldLabel htmlFor={`venue-request-${name}`}>{label}</FieldLabel>
                            <Input
                              id={`venue-request-${name}`}
                              ref={element => {
                                inputRefs.current[name] = element;
                              }}
                              type={type}
                              {...(type === "number" ? { min: "1", step: "1" } : {})}
                              placeholder={placeholder || undefined}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={changeEvent => field.handleChange(changeEvent.target.value)}
                              aria-invalid={field.state.meta.errors.length > 0}
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </Field>
                        )}
                      </form.Field>
                    ))}
                  </div>
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
