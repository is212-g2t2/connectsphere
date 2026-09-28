import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { formatProposedWindow } from "#/features/event-requests/format";
import {
  VENUE_RELEASE_REASON_MAX_LENGTH,
  VenueAmendmentInput,
  VenueReleaseInput,
} from "#/features/venue-requests/schema";
import { amendVenueBooking, releaseVenueBooking } from "#/features/venue-requests/server-fns";
import type { VenueBooking } from "#/features/venue-requests/server-fns";

interface VenueOption {
  id: number;
  name: string;
}

type Action = { kind: "release" | "amend"; id: string } | null;

interface AmendmentFormValues {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function ReleaseBookingForm({
  booking,
  onCancel,
  onSuccess,
}: {
  booking: VenueBooking;
  onCancel: () => void;
  onSuccess: () => Promise<void>;
}) {
  const form = useForm({
    defaultValues: { reason: "" },
    validators: {
      onSubmit: ({ value }) => {
        const parsed = VenueReleaseInput.safeParse({ id: booking.id, reason: value.reason });
        if (parsed.success) return undefined;
        return { fields: { reason: { message: parsed.error.issues[0].message } } };
      },
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await releaseVenueBooking({ data: VenueReleaseInput.parse({ id: booking.id, ...value }) });
      } catch (error) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: errorMessage(error, "Could not release this booking. Try again."),
          },
        });
        return;
      }

      toast.success(`Booking released for ${booking.eventName || "Untitled event"}.`);
      await onSuccess();
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4 border-t border-border pt-4"
      onSubmit={event => {
        event.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Field name="reason">
        {field => (
          <Field data-invalid={field.state.meta.errors.length > 0}>
            <FieldLabel htmlFor={`release-reason-${booking.id}`}>Reason for release</FieldLabel>
            <Textarea
              id={`release-reason-${booking.id}`}
              value={field.state.value}
              maxLength={VENUE_RELEASE_REASON_MAX_LENGTH}
              aria-invalid={field.state.meta.errors.length > 0}
              onChange={event => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
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
      <div className="flex gap-2">
        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => (
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "Releasing…" : "Confirm release"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AmendBookingForm({
  booking,
  venues,
  onCancel,
  onSuccess,
}: {
  booking: VenueBooking;
  venues: readonly VenueOption[];
  onCancel: () => void;
  onSuccess: () => Promise<void>;
}) {
  const defaultValues: AmendmentFormValues = {
    venueId: String(booking.venueId),
    date: booking.startsAt.slice(0, 10),
    startTime: booking.startsAt.slice(11, 16),
    endTime: booking.endsAt.slice(11, 16),
  };
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: ({ value }) => {
        const parsed = VenueAmendmentInput.safeParse({
          id: booking.id,
          venueId: Number(value.venueId),
          date: value.date,
          startTime: value.startTime,
          endTime: value.endTime,
        });
        if (parsed.success) return undefined;

        const fields: Record<string, { message: string }> = {};
        for (const issue of parsed.error.issues) {
          fields[String(issue.path[0])] ??= { message: issue.message };
        }
        return { fields };
      },
    },
    onSubmit: async ({ value, formApi }) => {
      const input = VenueAmendmentInput.parse({
        id: booking.id,
        venueId: Number(value.venueId),
        date: value.date,
        startTime: value.startTime,
        endTime: value.endTime,
      });

      try {
        await amendVenueBooking({ data: input });
      } catch (error) {
        const message = errorMessage(error, "Could not amend this booking. Try again.");
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form: message,
          },
        });
        return;
      }

      toast.success(`Booking amended for ${booking.eventName || "Untitled event"}.`);
      await onSuccess();
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2"
      onSubmit={event => {
        event.preventDefault();
        if (form.state.isSubmitting) return;
        void form.handleSubmit();
      }}
    >
      <form.Subscribe selector={state => state.errorMap.onSubmit}>
        {onSubmitError => {
          const refused = typeof onSubmitError === "string";
          return (
            <>
              <form.Field name="venueId">
                {field => {
                  const invalid = refused || field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`amend-venue-${booking.id}`}>Venue</FieldLabel>
                      <select
                        id={`amend-venue-${booking.id}`}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 body-sm"
                        aria-invalid={invalid}
                        value={field.state.value}
                        onChange={event => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                      >
                        <option value="">Choose a venue</option>
                        {venues.map(venue => (
                          <option key={venue.id} value={venue.id}>
                            {venue.name}
                          </option>
                        ))}
                      </select>
                      <FieldError errors={field.state.meta.errors} />
                      {refused ? <FieldError>{onSubmitError}</FieldError> : null}
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="date">
                {field => {
                  const invalid = refused || field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`amend-date-${booking.id}`}>Date</FieldLabel>
                      <Input
                        id={`amend-date-${booking.id}`}
                        type="date"
                        aria-invalid={invalid}
                        value={field.state.value}
                        onChange={event => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="startTime">
                {field => {
                  const invalid = refused || field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`amend-start-${booking.id}`}>Start time</FieldLabel>
                      <Input
                        id={`amend-start-${booking.id}`}
                        type="time"
                        aria-invalid={invalid}
                        value={field.state.value}
                        onChange={event => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="endTime">
                {field => {
                  const invalid = refused || field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`amend-end-${booking.id}`}>End time</FieldLabel>
                      <Input
                        id={`amend-end-${booking.id}`}
                        type="time"
                        aria-invalid={invalid}
                        value={field.state.value}
                        onChange={event => field.handleChange(event.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  );
                }}
              </form.Field>
            </>
          );
        }}
      </form.Subscribe>
      <div className="flex gap-2 sm:col-span-2">
        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save amendment"}
            </Button>
          )}
        </form.Subscribe>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** PTR-37 AC1: the shared approved-booking list and its release/amend action surface. */
export function VenueBookingsPage({
  bookings,
  venues,
  currentStaffId,
}: {
  bookings: readonly VenueBooking[];
  venues: readonly VenueOption[];
  currentStaffId: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action>(null);

  async function finishAction() {
    setAction(null);
    await router.invalidate();
  }

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Venue operations"
        title="Approved bookings"
        description="Review upcoming bookings the venues are holding. Release a period when an operational issue makes it unusable, or amend the venue and time when a different arrangement is agreed."
      />

      {bookings.length === 0 ? (
        <Card>
          <CardContent>
            <p className="body-sm text-muted-foreground">No upcoming approved bookings.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {bookings.map(booking => {
            const currentAction = action?.id === booking.id ? action.kind : null;
            const canChangeBooking =
              booking.assignedStaffId === null || booking.assignedStaffId === currentStaffId;
            return (
              <Card key={booking.id}>
                <CardContent>
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="eyebrow text-muted-foreground">Approved booking</p>
                        <h2 className="mt-2 display-h3">{booking.eventName || "Untitled event"}</h2>
                        <p className="mt-2 body-sm text-muted-foreground">
                          {booking.venueName} ·{" "}
                          {formatProposedWindow({
                            start: booking.startsAt,
                            end: booking.endsAt,
                          })}
                        </p>
                      </div>
                      {canChangeBooking ? (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            aria-label={`Amend ${booking.eventName || "Untitled event"}`}
                            onClick={() => setAction({ kind: "amend", id: booking.id })}
                          >
                            Amend
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            aria-label={`Release ${booking.eventName || "Untitled event"}`}
                            onClick={() => setAction({ kind: "release", id: booking.id })}
                          >
                            Release
                          </Button>
                        </div>
                      ) : (
                        <p className="body-sm text-muted-foreground">
                          Managed by another Venue Staff member.
                        </p>
                      )}
                    </div>

                    {currentAction === "release" ? (
                      <ReleaseBookingForm
                        booking={booking}
                        onCancel={() => setAction(null)}
                        onSuccess={finishAction}
                      />
                    ) : null}

                    {currentAction === "amend" ? (
                      <AmendBookingForm
                        booking={booking}
                        venues={venues}
                        onCancel={() => setAction(null)}
                        onSuccess={finishAction}
                      />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}
