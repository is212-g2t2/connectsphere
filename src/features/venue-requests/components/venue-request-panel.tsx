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
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { formatProposedWindow } from "#/features/event-requests/format";
import { EventRequirements } from "#/features/events/components/event-requirements";
import { VenueRequestInput } from "#/features/venue-requests/schema";
import type { VenueRequestPrefill, VenueRequestValues } from "#/features/venue-requests/schema";
import { requestVenue, withdrawVenueRequest } from "#/features/venue-requests/server-fns";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";

const FIELDS = ["date", "startTime", "endTime"] as const;

type FieldName = (typeof FIELDS)[number];

/**
 * Prefill the form with the event's proposed window or the adjusted window from the rejection card.
 * A request covers one civil day. Leave times empty for a multi-day or cross-midnight window so
 * the Coordinator chooses a valid range instead of silently truncating it.
 */
function toFormValues(
  event: VenueRequestContext["event"],
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
 * PTR-31: Let the Coordinator raise a booking request for the event they came from or withdraw a
 * pending request. The route renders this panel only when the loader finds a requestable event.
 * Server middleware still controls access.
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
  const request = context.request;
  const sameDay = context.event.endDate === context.event.eventDate;
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
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const [withdrawState, withdraw, withdrawing] = useMutation(async (requestId: string) => {
    await withdrawVenueRequest({ data: { id: requestId } });
    toast.success("Venue request withdrawn.");
    await router.invalidate();
  }, "Could not withdraw this request. Try again.");

  const form = useForm({
    defaultValues: toFormValues(context.event, venueId, stablePrefill),
    // `VenueRequestInput` uses the server's rules. Validate ids, date, and times once, then mark each field with its issue.
    validators: { onSubmit: VenueRequestInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await requestVenue({ data: value });
        toast.success("Venue request sent.");
        // The loader owns the panel state. Rerun it to replace the form with the pending request.
        await router.invalidate();
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

  // Reset the controls when the event, venue, or request changes. Reset from props instead of
  // remounting so the inputs stay in sync without dropping text the Coordinator is typing.
  useEffect(() => {
    form.reset(toFormValues(context.event, venueId, stablePrefill));
  }, [context, venueId, stablePrefill, form]);

  // An adjusted request comes from the rejection card, below the venue record. Focus its heading
  // so the reader lands on the prefilled form. Do this only while the form is visible; the URL
  // keeps the window after submission.
  const showsForm = request === null;
  useEffect(() => {
    if (stablePrefill && showsForm) headingRef.current?.focus();
  }, [stablePrefill, showsForm]);

  // Sending or withdrawing replaces the panel under the same heading. Move focus so readers hear
  // the new state. Do this only when the request changes but the event and venue stay the same.
  // Leave focus alone during venue navigation. The first run only records the current ids.
  const contextKey = `${context.event.id}:${venueId}`;
  const requestId = request?.id ?? null;
  const previous = useRef<{ contextKey: string; requestId: string | null } | null>(null);
  useEffect(() => {
    const previousValue = previous.current;
    previous.current = { contextKey, requestId };
    if (previousValue === null) return;
    if (previousValue.contextKey === contextKey && previousValue.requestId !== requestId) {
      headingRef.current?.focus();
    }
  }, [contextKey, requestId]);

  return (
    <section className="mt-8" aria-labelledby="venue-request-heading">
      <Card>
        <CardContent>
          <div className="flex items-center gap-2">
            <h2
              id="venue-request-heading"
              ref={headingRef}
              tabIndex={-1}
              aria-describedby={stablePrefill && showsForm ? "venue-request-context" : undefined}
              className="display-h3"
            >
              {request ? "Venue request" : "Request this venue"}
            </h2>
            {request && <Badge variant="progress">Pending</Badge>}
          </div>

          {request ? (
            <>
              <EventRequirements event={context.event} className="mt-4" />
              <p className="mt-4 body-sm text-muted-foreground">
                {context.event.name} on{" "}
                {formatProposedWindow({ start: request.startsAt, end: request.endsAt })}. Venue
                Staff decide from the pending queue.
              </p>
              {request.canWithdraw ? (
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button variant="destructive" size="sm" className="mt-5 w-fit" />}
                  >
                    Withdraw request
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Withdraw request</AlertDialogTitle>
                      <AlertDialogDescription>
                        This withdraws the booking request for {context.event.name}. Venue Staff
                        will no longer see it in their queue.
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
                        onClick={() => void withdraw(request.id)}
                      >
                        {withdrawing ? "Withdrawing…" : "Confirm"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                    {withdrawState.status === "error" && (
                      <p role="alert" className="body-sm text-destructive">
                        {withdrawState.error}
                      </p>
                    )}
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <p className="mt-5 body-sm text-muted-foreground">
                  Raised by another Coordinator, so only they can withdraw it.
                </p>
              )}
            </>
          ) : (
            <>
              <p id="venue-request-context" className="mt-2 body-sm text-muted-foreground">
                Send Venue Staff a booking request for {venueName} on behalf of {context.event.name}
                .
                {stablePrefill &&
                  " The date and times below were carried over from the rejected request; change them if needed."}
              </p>
              {!sameDay && (
                <p className="mt-2 body-sm text-muted-foreground">
                  This event spans more than one day, so choose the date and times this request
                  covers.
                </p>
              )}
              <EventRequirements event={context.event} className="mt-4" />
              <form
                noValidate
                className="mt-5 space-y-4"
                onSubmit={event => {
                  event.preventDefault();
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
                          onChange={event => field.handleChange(event.target.value)}
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
                          onChange={event => field.handleChange(event.target.value)}
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
                          onChange={event => field.handleChange(event.target.value)}
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
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
