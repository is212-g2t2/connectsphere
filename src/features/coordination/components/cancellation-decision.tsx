import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import {
  AlertDialog,
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
import { Textarea } from "#/components/ui/textarea";
import { formatVenuePeriod } from "#/features/event-requests/format";
import {
  CANCELLATION_DECLINE_REASON_MAX,
  CANCELLATION_REASON_MAX,
  EVENT_CANCELLATION_CLOSED,
  EventCancellationDeclineInput,
  EventCancellationInput,
} from "#/features/event-requests/schema";
import type { OutstandingReleases } from "#/features/events/cancellation";
import { cancelEvent, declineEventCancellation } from "#/features/events/server-fns";
import { toLocalMinuteValue } from "#/features/venues/availability";
import { skipRootFilter } from "#/lib/invalidate";

/**
 * PTR-54: the assigned Coordinator processes the Organiser's waiting cancellation request, either
 * by cancelling the event or by declining with a reason (AC8). The event's arrangements are not
 * released here (AC6); the page lists them once the event is cancelled. A request can wait while
 * the event is completed (PTR-25), and `canCancel` is then false: only the decline is offered.
 *
 * PTR-164 AC1: cancelling needs a reason, carried on every cancellation notice.
 */
export function CancellationDecision({
  requestId,
  eventName,
  canCancel,
}: {
  requestId: number;
  eventName: string;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const cancelForm = useForm({
    defaultValues: { reason: "" },
    validators: { onSubmit: EventCancellationInput.omit({ id: true }) },
    onSubmit: async ({ value, formApi }) => {
      try {
        await cancelEvent({ data: { id: requestId, reason: value.reason } });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error && error.message
                ? error.message
                : "Could not cancel this event. Try again.",
          },
        });
        return;
      }
      formApi.reset();
      setDialogOpen(false);
      toast.success("Event cancelled. Everyone concerned will be notified.");
      await router.invalidate({ filter: skipRootFilter });
    },
  });

  const declineForm = useForm({
    defaultValues: { reason: "" },
    validators: { onSubmit: EventCancellationDeclineInput.omit({ id: true }) },
    onSubmit: async ({ value, formApi }) => {
      try {
        await declineEventCancellation({ data: { id: requestId, reason: value.reason } });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              error instanceof Error && error.message
                ? error.message
                : "Could not decline this request. Try again.",
          },
        });
        return;
      }
      toast.success("Cancellation request declined.");
      formApi.reset();
      await router.invalidate({ filter: skipRootFilter });
    },
  });

  return (
    <section className="mt-8" aria-labelledby="cancellation-decision-heading">
      <Card>
        <CardContent>
          <h2 id="cancellation-decision-heading" className="display-h3">
            Cancellation requested
          </h2>
          {canCancel ? (
            <p className="mt-2 body-sm text-muted-foreground">
              The Organiser asked for this event to be cancelled. Cancelling notifies the Organiser,
              the registered Attendees and the staff holding arrangements. Bookings, holds and
              reservations stay held until the staff concerned release them.
            </p>
          ) : (
            <p className="mt-2 body-sm text-muted-foreground">
              The Organiser asked for this event to be cancelled. {EVENT_CANCELLATION_CLOSED}{" "}
              Decline the request to tell the Organiser why.
            </p>
          )}

          {canCancel && (
            <div className="mt-4 flex flex-col items-start gap-2">
              <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <AlertDialogTrigger render={<Button variant="destructive" />}>
                  Cancel event
                </AlertDialogTrigger>
                <AlertDialogContent size="sm">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel event</AlertDialogTitle>
                    <AlertDialogDescription>
                      This cancels {eventName}. You cannot undo it. The Organiser, the registered
                      Attendees and the staff holding arrangements are told why.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <form
                    noValidate
                    onSubmit={event => {
                      event.preventDefault();
                      void cancelForm.handleSubmit();
                    }}
                  >
                    <cancelForm.Field name="reason">
                      {field => (
                        <Field data-invalid={field.state.meta.errors.length > 0}>
                          <FieldLabel htmlFor="cancellation-reason">
                            Reason for cancelling
                          </FieldLabel>
                          <Textarea
                            id="cancellation-reason"
                            rows={3}
                            maxLength={CANCELLATION_REASON_MAX}
                            value={field.state.value}
                            aria-invalid={field.state.meta.errors.length > 0}
                            onChange={event => field.handleChange(event.target.value)}
                            onBlur={field.handleBlur}
                          />
                          <FieldError errors={field.state.meta.errors} />
                        </Field>
                      )}
                    </cancelForm.Field>
                    <cancelForm.Subscribe
                      selector={state => [state.isSubmitting, state.errorMap.onSubmit]}
                    >
                      {([isSubmitting, onSubmitError]) => (
                        <>
                          <AlertDialogFooter>
                            <AlertDialogCancel size="sm" disabled={Boolean(isSubmitting)}>
                              Keep event
                            </AlertDialogCancel>
                            <Button
                              type="submit"
                              size="sm"
                              variant="destructive"
                              disabled={Boolean(isSubmitting)}
                            >
                              {isSubmitting ? "Cancelling…" : "Cancel the event"}
                            </Button>
                          </AlertDialogFooter>
                          {typeof onSubmitError === "string" ? (
                            <p role="alert" className="mt-2 body-sm text-destructive">
                              {onSubmitError}
                            </p>
                          ) : null}
                        </>
                      )}
                    </cancelForm.Subscribe>
                  </form>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          <form
            noValidate
            className="mt-6 space-y-4 border-t border-border pt-4"
            onSubmit={event => {
              event.preventDefault();
              void declineForm.handleSubmit();
            }}
          >
            <declineForm.Field name="reason">
              {field => (
                <Field data-invalid={field.state.meta.errors.length > 0}>
                  <FieldLabel htmlFor="cancellation-decline-reason">
                    Reason for declining
                  </FieldLabel>
                  <Textarea
                    id="cancellation-decline-reason"
                    rows={3}
                    maxLength={CANCELLATION_DECLINE_REASON_MAX}
                    value={field.state.value}
                    aria-invalid={field.state.meta.errors.length > 0}
                    onChange={event => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </declineForm.Field>
            <declineForm.Subscribe
              selector={state => [state.isSubmitting, state.errorMap.onSubmit]}
            >
              {([isSubmitting, onSubmitError]) => (
                <>
                  <Button type="submit" variant="outline" disabled={Boolean(isSubmitting)}>
                    {isSubmitting ? "Declining…" : "Decline request"}
                  </Button>
                  {typeof onSubmitError === "string" ? (
                    <p role="alert" className="body-sm text-destructive">
                      {onSubmitError}
                    </p>
                  ) : null}
                </>
              )}
            </declineForm.Subscribe>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * PTR-54 AC2, AC6: what the cancelled event still holds. The list is read when the page loads, so
 * an item leaves it once Venue Staff, Technical Support or the Coordinator release it.
 */
export function OutstandingReleasesList({ releases }: { releases: OutstandingReleases }) {
  const items = [
    ...releases.venueBookings.map(booking => ({
      id: `booking-${booking.id}`,
      content: `Venue booking: ${booking.venueName}, ${formatVenuePeriod(booking.startsAt, booking.endsAt)} — Venue Staff release it`,
    })),
    ...releases.venueHolds.map(hold => ({
      id: `hold-${hold.id}`,
      content: (
        <>
          Tentative hold: {hold.venueName}, {formatVenuePeriod(hold.startsAt, hold.endsAt)} —{" "}
          <Link
            to="/venues/availability"
            search={{
              venueId: hold.venueId,
              startDate: toLocalMinuteValue(hold.startsAt).slice(0, 10),
              endDate: toLocalMinuteValue(hold.endsAt).slice(0, 10),
            }}
            className="underline decoration-foreground/60 underline-offset-4 hover:decoration-foreground"
          >
            release it on the venue calendar
          </Link>
        </>
      ),
    })),
    ...releases.equipmentReservations.map(line => ({
      id: `equipment-${line.id}`,
      content: `Equipment reservation: ${line.item} × ${line.quantity} — Technical Support release it`,
    })),
  ];

  return (
    <section className="mt-8" aria-labelledby="outstanding-releases-heading">
      <Card>
        <CardContent>
          <h2 id="outstanding-releases-heading" className="display-h3">
            Outstanding releases
          </h2>
          {items.length === 0 ? (
            <p className="mt-2 body-sm text-muted-foreground">
              Nothing is still held for this event.
            </p>
          ) : (
            <>
              <p className="mt-2 body-sm text-muted-foreground">
                The event is cancelled, but these are still held. Nothing is released automatically.
              </p>
              <ul className="mt-4 list-disc space-y-1 pl-5 body-md">
                {items.map(item => (
                  <li key={item.id}>{item.content}</li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
