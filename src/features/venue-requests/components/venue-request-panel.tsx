import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
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
import type { VenueRequestValues } from "#/features/venue-requests/schema";
import { requestVenue, withdrawVenueRequest } from "#/features/venue-requests/server-fns";
import type { VenueRequestContext } from "#/features/venue-requests/server-fns";
import { useMutation } from "#/hooks/use-mutation";

const FIELDS = ["date", "startTime", "endTime"] as const;

type FieldName = (typeof FIELDS)[number];

/**
 * The inputs hold the event's proposed window as the form's values. A request covers one civil
 * day, so a multi-day (or cross-midnight) window leaves the times empty rather than silently
 * truncating to its first day — the required-field and order messages then force a conscious
 * choice.
 */
function toFormValues(event: VenueRequestContext["event"], venueId: number): VenueRequestValues {
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
 * PTR-31's action surface on the venue page: raise a booking request for an event the Coordinator
 * came from, or withdraw the pending one. The route only renders it when the loader found a
 * requestable event, so everything here is the aftermath of a decision rather than access control.
 */
export function VenueRequestPanel({
  venueId,
  venueName,
  context,
}: {
  venueId: number;
  venueName: string;
  context: VenueRequestContext;
}) {
  const router = useRouter();
  const request = context.request;
  const sameDay = context.event.endDate === context.event.eventDate;
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
    defaultValues: toFormValues(context.event, venueId),
    // `VenueRequestInput` is the same gate the server uses, so the ids, the date and the times are
    // checked once and every issue marks its own field.
    validators: { onSubmit: VenueRequestInput },
    onSubmit: async ({ value, formApi }) => {
      try {
        await requestVenue({ data: value });
        toast.success("Venue request sent.");
        // The loader is the only source for the panel's state: re-running it is what swaps the form
        // for the pending request.
        await router.invalidate();
      } catch (error) {
        // `fields` is what makes the library read this as a global error and store `form` verbatim.
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error ? error.message : "Could not send this request. Try again.",
          },
        });
      }
    },
    // A failed submit is the library's own signal; this points focus at the first field the schema
    // marked, in the panel's left-to-right order, so the reader lands where the problem is.
    onSubmitInvalid: ({ formApi }) => {
      const firstInvalid = FIELDS.find(
        field => (formApi.state.fieldMeta[field]?.errors.length ?? 0) > 0
      );
      if (firstInvalid) inputRefs.current[firstInvalid]?.focus();
    },
  });

  // A new event, venue or request reseeds the controls. Resetting from the props, rather than
  // remounting on a key, keeps the inputs in step without dropping what was mid-typing, the
  // pattern `venue-list-page.tsx` follows.
  useEffect(() => {
    form.reset(toFormValues(context.event, venueId));
  }, [context, venueId, form]);

  // Sending or withdrawing swaps the panel's branch under the same heading, so focus would
  // otherwise fall to `<body>` and the new state go unannounced. Only a request that changed
  // while the event and venue stayed put is that swap — a venue-to-venue navigation changes the
  // context too and must leave focus alone, and the first run only records the identity.
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
            <h2 id="venue-request-heading" ref={headingRef} tabIndex={-1} className="display-h3">
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
              <p className="mt-2 body-sm text-muted-foreground">
                Send Venue Staff a booking request for {venueName} on behalf of {context.event.name}
                .
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
                  // The library has no re-entrancy check, and a second click can land before
                  // React disables the button.
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
