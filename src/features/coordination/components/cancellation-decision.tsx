import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
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
import { Textarea } from "#/components/ui/textarea";
import { formatProposedWindow } from "#/features/event-requests/format";
import {
  CANCELLATION_DECLINE_REASON_MAX,
  EventCancellationDeclineInput,
} from "#/features/event-requests/schema";
import type { OutstandingReleases } from "#/features/events/cancellation";
import { cancelEvent, declineEventCancellation } from "#/features/events/server-fns";
import { useMutation } from "#/hooks/use-mutation";

/**
 * PTR-54: the assigned Coordinator processes the Organiser's waiting cancellation request, either
 * by cancelling the event or by declining with a reason (AC8). The event's arrangements are not
 * released here (AC6); the page lists them once the event is cancelled.
 */
export function CancellationDecision({
  requestId,
  eventName,
}: {
  requestId: number;
  eventName: string;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancellation, cancel, cancelling] = useMutation(async () => {
    await cancelEvent({ data: { id: requestId } });
    setDialogOpen(false);
    toast.success("Event cancelled. Everyone concerned will be notified.");
    await router.invalidate();
  }, "Could not cancel this event. Try again.");

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
      await router.invalidate();
    },
  });

  return (
    <section className="mt-8" aria-labelledby="cancellation-decision-heading">
      <Card>
        <CardContent>
          <h2 id="cancellation-decision-heading" className="display-h3">
            Cancellation requested
          </h2>
          <p className="mt-2 body-sm text-muted-foreground">
            The Organiser asked for this event to be cancelled. Cancelling notifies the Organiser,
            the registered Attendees and the staff holding arrangements. Bookings, holds and
            reservations stay held until the staff concerned release them.
          </p>

          <div className="mt-4 flex flex-col items-start gap-2">
            <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <AlertDialogTrigger render={<Button variant="destructive" disabled={cancelling} />}>
                Cancel event
              </AlertDialogTrigger>
              <AlertDialogContent size="sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel event</AlertDialogTitle>
                  <AlertDialogDescription>
                    This cancels {eventName}. You cannot undo it.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel size="sm" disabled={cancelling}>
                    Keep event
                  </AlertDialogCancel>
                  <AlertDialogAction
                    size="sm"
                    variant="destructive"
                    disabled={cancelling}
                    onClick={() => void cancel()}
                  >
                    {cancelling ? "Cancelling…" : "Cancel the event"}
                  </AlertDialogAction>
                </AlertDialogFooter>
                {cancellation.status === "error" ? (
                  <p role="alert" className="body-sm text-destructive">
                    {cancellation.error}
                  </p>
                ) : null}
              </AlertDialogContent>
            </AlertDialog>
          </div>

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

/** A floating venue-local period (`2026-12-05 10:00:00`) in the proposed-window wording. */
function formatPeriod(startsAt: string, endsAt: string): string {
  return formatProposedWindow({
    start: startsAt.slice(0, 16).replace(" ", "T"),
    end: endsAt.slice(0, 16).replace(" ", "T"),
  });
}

/**
 * PTR-54 AC2, AC6: what the cancelled event still holds. The list is read when the page loads, so
 * an item leaves it once Venue Staff, Technical Support or the Coordinator release it.
 */
export function OutstandingReleasesList({ releases }: { releases: OutstandingReleases }) {
  const items = [
    ...releases.venueBookings.map(booking => ({
      id: `booking-${booking.id}`,
      text: `Venue booking: ${booking.venueName}, ${formatPeriod(booking.startsAt, booking.endsAt)} — Venue Staff release it`,
    })),
    ...releases.venueHolds.map(hold => ({
      id: `hold-${hold.id}`,
      text: `Tentative hold: ${hold.venueName}, ${formatPeriod(hold.startsAt, hold.endsAt)} — you release it`,
    })),
    ...releases.equipmentReservations.map(line => ({
      id: `equipment-${line.id}`,
      text: `Equipment reservation: ${line.item} × ${line.quantity} — Technical Support release it`,
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
                  <li key={item.id}>{item.text}</li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
