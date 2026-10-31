import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { PencilLine, Unlock } from "lucide-react";
import { toast } from "sonner";

import { Page, PageHeader } from "#/components/layout/page";
import { Button } from "#/components/ui/button";
import { IconAction } from "#/components/ui/icon-action";
import { Card, CardContent } from "#/components/ui/card";
import { Field, FieldError, FieldLabel } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import { formatLocalDate, formatProposedWindow } from "#/features/event-requests/format";
import {
  VENUE_RELEASE_REASON_MAX_LENGTH,
  VenueAmendmentInput,
  VenueReleaseInput,
  formIssues,
} from "#/features/venue-requests/schema";
import { amendVenueBooking, releaseVenueBooking } from "#/features/venue-requests/server-fns";
import type { VenueBooking } from "#/features/venue-requests/server-fns";
import { skipRootFilter } from "#/lib/invalidate";

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
      onSubmit: ({ value }) =>
        formIssues(VenueAmendmentInput, {
          id: booking.id,
          venueId: Number(value.venueId),
          date: value.date,
          startTime: value.startTime,
          endTime: value.endTime,
        }),
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
                        className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 body-sm"
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
  const [venueFilter, setVenueFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  async function finishAction() {
    setAction(null);
    await router.invalidate({ filter: skipRootFilter });
  }

  const filtered = bookings.filter(
    booking =>
      (venueFilter === "" || String(booking.venueId) === venueFilter) &&
      (monthFilter === "" || booking.startsAt.slice(0, 7) === monthFilter)
  );
  const groups = useMemo(() => groupBookingsByMonth(filtered), [filtered]);
  const filtering = venueFilter !== "" || monthFilter !== "";

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Venue operations"
        title="Approved bookings"
        description="Review upcoming bookings the venues are holding. Release a period when an operational issue makes it unusable, or amend the venue and time when a different arrangement is agreed."
      />

      <p className="body-sm text-muted-foreground" aria-live="polite">
        {bookingCountCopy(filtered.length, bookings.length)}
      </p>

      {bookings.length === 0 ? (
        <Card>
          <CardContent>
            <p className="body-sm text-muted-foreground">No upcoming approved bookings.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field>
                  <FieldLabel htmlFor="booking-venue-filter">Filter by venue</FieldLabel>
                  <Select
                    value={venueFilter === "" ? "__all__" : venueFilter}
                    onValueChange={value =>
                      setVenueFilter(value === "__all__" ? "" : (value ?? ""))
                    }
                  >
                    <SelectTrigger id="booking-venue-filter" className="w-full">
                      <SelectValue>
                        {(value: string | null) =>
                          venues.find(option => String(option.id) === value)?.name ?? "All venues"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All venues</SelectItem>
                      {venues.map(venue => (
                        <SelectItem key={venue.id} value={String(venue.id)}>
                          {venue.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="booking-month-filter">Filter by month</FieldLabel>
                  <Input
                    id="booking-month-filter"
                    type="month"
                    value={monthFilter}
                    onChange={event => setMonthFilter(event.target.value)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!filtering}
                  onClick={() => {
                    setVenueFilter("");
                    setMonthFilter("");
                  }}
                >
                  Clear
                </Button>
              </div>
            </CardContent>
          </Card>

          {groups.length === 0 ? (
            <Card>
              <CardContent>
                <p className="body-sm text-muted-foreground">No bookings match these filters.</p>
              </CardContent>
            </Card>
          ) : (
            groups.map(([month, rows]) => (
              <section key={month} aria-label={monthGroupLabel(month)} className="mt-8">
                <h2 className="display-h3">{monthGroupLabel(month)}</h2>
                <div className="mt-3 grid gap-3">
                  {rows.map(booking => {
                    const currentAction = action?.id === booking.id ? action.kind : null;
                    const canChangeBooking =
                      booking.assignedStaffId === null ||
                      booking.assignedStaffId === currentStaffId;
                    return (
                      <Card key={booking.id}>
                        <CardContent>
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="eyebrow text-muted-foreground">Approved booking</p>
                                <h3 className="mt-1 display-h3">
                                  {booking.eventName || "Untitled event"}
                                </h3>
                                <p className="mt-1 body-sm text-muted-foreground">
                                  {booking.venueName} ·{" "}
                                  {formatProposedWindow({
                                    start: booking.startsAt,
                                    end: booking.endsAt,
                                  })}
                                </p>
                              </div>
                              {canChangeBooking ? (
                                <div className="flex gap-2">
                                  <IconAction
                                    label={`Amend ${booking.eventName || "Untitled event"}`}
                                    icon={<PencilLine />}
                                    onClick={() => setAction({ kind: "amend", id: booking.id })}
                                  />
                                  <IconAction
                                    label={`Release ${booking.eventName || "Untitled event"}`}
                                    icon={<Unlock />}
                                    tone="danger"
                                    onClick={() => setAction({ kind: "release", id: booking.id })}
                                  />
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
              </section>
            ))
          )}
        </>
      )}
    </Page>
  );
}

/** Group the queue by start month (`YYYY-MM`), oldest first, for the section headings. */
export function groupBookingsByMonth(bookings: readonly VenueBooking[]) {
  const groups = new Map<string, VenueBooking[]>();
  for (const booking of bookings) {
    const month = booking.startsAt.slice(0, 7);
    const rows = groups.get(month);
    if (rows) rows.push(booking);
    else groups.set(month, [booking]);
  }
  return [...groups.entries()];
}

/** Name one `YYYY-MM` group with the shared date helper, for example "Nov 2030". */
export function monthGroupLabel(month: string) {
  return formatLocalDate(`${month}-01`).replace(/^\d+ /, "");
}

function bookingCountCopy(filtered: number, total: number) {
  if (filtered !== total) return `Showing ${filtered} of ${total} upcoming bookings`;
  return total === 1 ? "1 upcoming booking" : `${total} upcoming bookings`;
}
