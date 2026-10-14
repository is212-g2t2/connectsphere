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
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { formatProposedWindow } from "#/features/event-requests/format";
import { EventRequirements } from "#/features/events/components/event-requirements";
import { VenueStateBadge } from "#/features/venue-requests/components/venue-state-badge";
import { VenueRequestInput } from "#/features/venue-requests/schema";
import type { VenueRequestPrefill, VenueRequestValues } from "#/features/venue-requests/schema";
import { requestVenue, withdrawVenueRequest } from "#/features/venue-requests/server-fns";
import type {
  VenueRequestContext,
  VenueRequestContextRow,
} from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";
import { skipRootFilter } from "#/lib/invalidate";

const FIELDS = ["date", "startTime", "endTime"] as const;

type FieldName = (typeof FIELDS)[number];

/** The event fields that set the form's default window. */
type EventWindow = Pick<
  VenueRequestContext["event"],
  "id" | "eventDate" | "endDate" | "startTime" | "endTime"
>;

/**
 * Prefill the form with the event's proposed window or the adjusted window from the rejection card.
 * A request covers one civil day. Leave times empty for a multi-day or cross-midnight window so
 * the Coordinator chooses a valid range instead of silently truncating it.
 */
function toFormValues(
  event: EventWindow,
  venueId: number,
  prefill: VenueRequestPrefill | null
): VenueRequestValues {
  if (prefill) return { eventId: event.id, venueId, ...prefill };
  const sameDay = event.endDate === event.eventDate;
  return {
    eventId: event.id,
    venueId,
    date: event.eventDate ?? "",
    startTime: sameDay ? (event.startTime ?? "") : "",
    endTime: sameDay ? (event.endTime ?? "") : "",
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

/** One request of the event at this venue: its window, its state, and its action. */
function VenueRequestRow({ row, venueName }: { row: VenueRequestContextRow; venueName: string }) {
  const period = formatProposedWindow({ start: row.startsAt, end: row.endsAt });
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="body-sm font-medium text-foreground">{period}</span>
        <VenueStateBadge status={row.status} />
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
  // reset what the Coordinator is typing. Use a carried window only when it is complete and
  // ordered. Fixed-width `HH:MM` strings compare as times, as `VenueRequestInput` requires.
  // Otherwise, use the event's proposed window.
  const prefillDate = prefill?.date;
  const prefillStart = prefill?.startTime;
  const prefillEnd = prefill?.endTime;
  const stablePrefill = useMemo<VenueRequestPrefill | null>(
    () =>
      prefillDate === undefined ||
      prefillStart === undefined ||
      prefillEnd === undefined ||
      prefillEnd <= prefillStart
        ? null
        : { date: prefillDate, startTime: prefillStart, endTime: prefillEnd },
    [prefillDate, prefillStart, prefillEnd]
  );
  const inputRefs = useRef<Record<FieldName, HTMLInputElement | null>>({
    date: null,
    startTime: null,
    endTime: null,
  });
  const listHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const formHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const form = useForm({
    defaultValues: toFormValues(event, venueId, stablePrefill),
    // `VenueRequestInput` uses the server's rules. Validate ids, date, and times once, then mark each field with its issue.
    validators: { onSubmit: VenueRequestInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await requestVenue({ data: value });
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

  // Reset the controls when the event, its window, the venue, or the carried window changes. Read
  // plain values, not the context object: every loader run makes a new object, and a withdrawal
  // must not drop text the Coordinator is typing.
  const { id: eventId, eventDate, endDate, startTime, endTime } = event;
  useEffect(() => {
    form.reset(
      toFormValues({ id: eventId, eventDate, endDate, startTime, endTime }, venueId, stablePrefill)
    );
  }, [eventId, eventDate, endDate, startTime, endTime, venueId, stablePrefill, form]);

  // An adjusted request comes from the rejection card, below the venue record. Focus the form
  // heading so the reader lands on the prefilled form.
  useEffect(() => {
    if (stablePrefill && canRequest) formHeadingRef.current?.focus();
  }, [stablePrefill, canRequest]);

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
                aria-describedby={stablePrefill ? "venue-request-context" : undefined}
                className="display-h3"
              >
                {requests.length === 0 ? "Request this venue" : "Request another time"}
              </h3>
              <p id="venue-request-context" className="mt-2 body-sm text-muted-foreground">
                Send Venue Staff a booking request for {venueName} on behalf of {event.name}.
                {stablePrefill &&
                  " The date and times below were carried over from the rejected request; change them if needed."}
              </p>
              {!sameDay && (
                <p className="mt-2 body-sm text-muted-foreground">
                  This event spans more than one day, so choose the date and times this request
                  covers.
                </p>
              )}
              <EventRequirements event={event} className="mt-4" />
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
