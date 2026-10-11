import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";

import { Page, PageHeader } from "#/components/layout/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Calendar, CalendarDayButton } from "#/components/ui/calendar";
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
import { can } from "#/features/auth/permissions";
import type { SessionUser } from "#/features/auth/session";
import {
  ConvertVenueHoldButton,
  PlaceVenueHoldDialog,
  ReleaseVenueHoldButton,
} from "#/features/venue-requests/components/venue-hold-actions";
import type { CoordinatorEventOption } from "#/features/venue-requests/components/venue-hold-actions";
import {
  compareTimestamps,
  timestampDay,
  timestampEndDay,
  timestampTime,
} from "#/features/venues/availability";
import type { OccupiedPeriod } from "#/features/venues/availability";
import { AvailabilitySelectionFormInput } from "#/features/venues/schema";
import type { AvailabilitySearch } from "#/features/venues/schema";
import type { Venue, VenueAvailability } from "#/features/venues/server-fns";
import { cn, NAV_LINK_CLASSNAME } from "#/lib/utils";

const OCCUPIED_STATES = {
  confirmed: {
    variant: "confirmed",
    label: "Confirmed booking",
    dotColor: "bg-harbor",
  },
  tentative_hold: {
    variant: "progress",
    label: "Tentative hold",
    dotColor: "bg-amber",
  },
  blocked: {
    variant: "stopped",
    label: "Unavailable / blocked",
    dotColor: "bg-coral",
  },
} as const satisfies Record<
  OccupiedPeriod["state"],
  {
    variant: React.ComponentProps<typeof Badge>["variant"];
    label: string;
    dotColor: string;
  }
>;

/** One formatter per shape. Construction parses its options, so reuse the instance. */
const DATE_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" });

/**
 * Show the venue calendar (PTR-28). Accept a venue and an inclusive date range. Return free,
 * confirmed, and blocked periods. The rows and the calendar come from the route loader, and the
 * applied search comes from the route, both as props. The page then renders in a unit test
 * without a router (PTR-75). Selecting a range navigates to the same route with new search
 * parameters. That navigation re-runs the loader, so no fetch state needs to stay in step.
 */
export function VenueCalendarPage({
  venues,
  schedule,
  search,
  user,
  coordinatorEvents,
}: {
  venues: Venue[];
  schedule: VenueAvailability | null;
  search: AvailabilitySearch;
  user?: SessionUser | null;
  coordinatorEvents?: readonly CoordinatorEventOption[];
}) {
  const navigate = useNavigate();
  const form = useForm({
    defaultValues: {
      venueId: search.venueId === undefined ? "" : String(search.venueId),
      startDate: search.startDate ?? "",
      endDate: search.endDate ?? "",
    },
    validators: {
      onSubmit: AvailabilitySelectionFormInput,
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await navigate({
          to: "/venues/availability",
          search: AvailabilitySelectionFormInput.parse(value),
        });
      } catch (submitError) {
        formApi.setErrorMap({
          onSubmit: {
            fields: {},
            form:
              submitError instanceof Error
                ? submitError.message
                : "Could not load availability. Try again.",
          },
        });
      }
    },
  });

  const [month, setMonth] = useState(() =>
    search.startDate ? civilDate(search.startDate) : new Date()
  );

  // Derive the day map, the picker modifiers, and the sorted rows once per schedule.
  // Typing a filter or flipping the month re-renders without rebuilding them.
  const { occupiedModifiers, periods } = useMemo(() => {
    const occupiedDays = new Map<string, OccupiedPeriod["state"]>();
    for (const period of schedule?.occupied ?? []) {
      for (
        let day = timestampDay(period.visibleStart);
        day <= timestampEndDay(period.visibleEnd);
        day = nextDay(day)
      ) {
        if (!occupiedDays.has(day)) occupiedDays.set(day, period.state);
      }
    }

    const modifiers: Record<OccupiedPeriod["state"], Date[]> = {
      confirmed: [],
      tentative_hold: [],
      blocked: [],
    };
    for (const [day, state] of occupiedDays) modifiers[state].push(civilDate(day));

    const rows = schedule
      ? [
          ...schedule.available.map(period => ({
            key: `available:${period.startsAt}`,
            label: "Available",
            state: "available" as const,
            startsAt: period.startsAt,
            endsAt: period.endsAt,
          })),
          ...schedule.occupied.map(period => ({
            key: `${period.state}:${period.id}`,
            id: period.id,
            label: period.label,
            state: period.state,
            startsAt: period.visibleStart,
            endsAt: period.visibleEnd,
            canRelease: period.canRelease,
            canConvert: period.canConvert,
          })),
        ].toSorted((left, right) => compareTimestamps(left.startsAt, right.startsAt))
      : [];
    return { occupiedModifiers: modifiers, periods: rows };
  }, [schedule]);

  const canHold = user ? can(user.role, { venue_request: ["request"] }) : false;

  return (
    <Page
      width="wide"
      sidebar={
        <aside aria-label="Calendar view">
          <Card>
            <CardContent>
              <form.Subscribe selector={state => [state.values.startDate, state.values.endDate]}>
                {([startDate, endDate]) => {
                  const selected = {
                    from: startDate ? civilDate(startDate) : undefined,
                    to:
                      endDate && startDate && endDate >= startDate ? civilDate(endDate) : undefined,
                  };
                  return (
                    <Calendar
                      mode="range"
                      timeZone="UTC"
                      selected={selected}
                      month={month}
                      onMonthChange={setMonth}
                      modifiers={occupiedModifiers}
                      onSelect={range => {
                        form.setFieldValue("startDate", range?.from ? civilDay(range.from) : "");
                        form.setFieldValue("endDate", range?.to ? civilDay(range.to) : "");
                      }}
                      components={{ DayButton: OccupiedDayButton }}
                    />
                  );
                }}
              </form.Subscribe>
              <ul
                aria-label="Availability legend"
                className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-4 body-sm text-muted-foreground"
              >
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full border border-border" />
                  Available
                </li>
                {Object.values(OCCUPIED_STATES).map(entry => (
                  <li key={entry.label} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn("size-2 rounded-full", entry.dotColor)}
                    />
                    {entry.label}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      }
    >
      <Link to="/dashboard" className={NAV_LINK_CLASSNAME}>
        Back to dashboard
      </Link>

      <PageHeader
        eyebrow="Venues"
        title="Venue calendar"
        description="Pick a venue and a date range to see when it can be requested — its free periods, confirmed bookings, tentative holds and recorded unavailability."
      />

      <section aria-label="Availability filters">
        <Card>
          <CardContent>
            {venues.length === 0 ? (
              <p className="body-sm text-muted-foreground">No venues recorded yet.</p>
            ) : (
              <form
                className="space-y-5"
                noValidate
                onSubmit={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <form.Field name="venueId">
                  {field => (
                    <Field data-invalid={field.state.meta.errors.length > 0}>
                      <FieldLabel htmlFor="availability-venue">Venue</FieldLabel>
                      <Select
                        value={field.state.value === "" ? null : field.state.value}
                        onValueChange={value => field.handleChange(value ?? "")}
                      >
                        <SelectTrigger
                          id="availability-venue"
                          className="w-full"
                          aria-invalid={field.state.meta.errors.length > 0}
                          onBlur={field.handleBlur}
                        >
                          <SelectValue>
                            {(value: string | null) =>
                              venues.find(option => String(option.id) === value)?.name ??
                              "Select a venue"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {venues.map(venue => (
                            <SelectItem key={venue.id} value={String(venue.id)}>
                              {venue.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="startDate">
                    {field => (
                      <Field className="min-w-0" data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor="availability-start">Start date</FieldLabel>
                        <Input
                          id="availability-start"
                          type="date"
                          value={field.state.value}
                          onChange={event => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                          aria-invalid={field.state.meta.errors.length > 0}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="endDate">
                    {field => (
                      <Field className="min-w-0" data-invalid={field.state.meta.errors.length > 0}>
                        <FieldLabel htmlFor="availability-end">End date</FieldLabel>
                        <Input
                          id="availability-end"
                          type="date"
                          value={field.state.value}
                          onChange={event => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                          aria-invalid={field.state.meta.errors.length > 0}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                </div>
                <form.Subscribe selector={state => [state.isSubmitting, state.errorMap.onSubmit]}>
                  {([isSubmitting, onSubmitError]) => (
                    <>
                      {typeof onSubmitError === "string" ? (
                        <p role="alert" className="body-sm text-destructive">
                          {onSubmitError}
                        </p>
                      ) : null}
                      <Button
                        type="submit"
                        className="w-full sm:w-auto"
                        disabled={Boolean(isSubmitting)}
                      >
                        {isSubmitting ? "Loading…" : "Show availability"}
                      </Button>
                    </>
                  )}
                </form.Subscribe>
              </form>
            )}
          </CardContent>
        </Card>
      </section>

      {schedule ? (
        <section aria-label="Availability results" className="mt-8">
          <Card>
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
                <div>
                  <h2 className="display-h2">{schedule.venue.name}</h2>
                  <p className="mt-2 body-sm text-muted-foreground">
                    {dateLabel(schedule.startDate)}
                    {schedule.endDate !== schedule.startDate && ` – ${dateLabel(schedule.endDate)}`}
                  </p>
                  <p className="mt-1 body-sm text-muted-foreground">
                    Times shown in venue local time
                  </p>
                </div>
                {canHold && (
                  <PlaceVenueHoldDialog
                    venueId={schedule.venue.id}
                    venueName={schedule.venue.name}
                    defaultDate={schedule.startDate}
                    coordinatorEvents={coordinatorEvents}
                  />
                )}
              </div>
              {periods.length === 0 ? (
                <p className="py-6 body-sm text-muted-foreground">
                  The venue has no opening hours in this range.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {periods.map(period => (
                    <li key={period.key} className="flex flex-wrap items-center gap-4 py-4">
                      <DateChip day={timestampDay(period.startsAt)} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{period.label}</p>
                        <p className="body-sm text-muted-foreground">
                          {timeRange(period)} · {schedule.venue.name}
                        </p>
                      </div>
                      {period.state !== "available" && (
                        <Badge variant={OCCUPIED_STATES[period.state].variant}>
                          {OCCUPIED_STATES[period.state].label}
                        </Badge>
                      )}
                      {period.state === "tentative_hold" &&
                        period.id &&
                        canHold &&
                        (period.canRelease || period.canConvert) && (
                          <div className="flex items-center gap-2">
                            {period.canConvert && <ConvertVenueHoldButton holdId={period.id} />}
                            {period.canRelease && <ReleaseVenueHoldButton holdId={period.id} />}
                          </div>
                        )}
                      {period.state === "available" && canHold && (
                        <PlaceVenueHoldDialog
                          venueId={schedule.venue.id}
                          venueName={schedule.venue.name}
                          defaultDate={timestampDay(period.startsAt)}
                          defaultStartTime={timestampTime(period.startsAt).slice(0, 5)}
                          defaultEndTime={timestampTime(period.endsAt).slice(0, 5)}
                          coordinatorEvents={coordinatorEvents}
                          trigger={
                            <Button size="sm" variant="ghost">
                              Hold slot
                            </Button>
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      ) : (
        <p className="mt-8 flex items-center gap-2 body-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden="true" />
          Choose a venue and both dates to see its availability.
        </p>
      )}
    </Page>
  );
}

/**
 * Show the month grid day cell. Mark a day that holds an occupied period with a dot. Read modifiers
 * from the day picker, so this cell needs nothing from the page. Keep it module-level. A component
 * defined during render becomes a new type on each pass, and React remounts it.
 */
function OccupiedDayButton(props: React.ComponentProps<typeof CalendarDayButton>) {
  // The day map holds one state per day, so at most one modifier matches. Check blocked first.
  // Keep the previous precedence if the states ever change.
  const dotState = (["blocked", "tentative_hold", "confirmed"] as const).find(
    state => props.modifiers[state]
  );
  const dot = dotState ? OCCUPIED_STATES[dotState].dotColor : null;
  return (
    <CalendarDayButton {...props}>
      {props.children}
      {dot ? <span aria-hidden="true" className={cn("mt-0.5 size-1.5 rounded-full", dot)} /> : null}
    </CalendarDayButton>
  );
}

/**
 * Use UTC for the civil date the picker and inputs use. Never use the venue product timezone.
 * Format every rendered value with `timeZone: "UTC"`.
 */
function civilDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function civilDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function nextDay(value: string) {
  const date = civilDate(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return civilDay(date);
}

function dateLabel(value: string) {
  return DATE_LABEL.format(civilDate(value));
}

/** Show a booking past midnight as `23:00 - 24:00` when it ends at range end. */
function timeRange(period: { startsAt: string; endsAt: string }) {
  const start = timestampTime(period.startsAt).slice(0, 5);
  const endClock = timestampTime(period.endsAt).slice(0, 5);
  const end =
    timestampEndDay(period.endsAt) === timestampDay(period.startsAt)
      ? endClock
      : timestampTime(period.endsAt).startsWith("00:00:00")
        ? "24:00"
        : `${DAY_MONTH.format(civilDate(timestampDay(period.endsAt)))} ${endClock}`;
  return `${start} – ${end}`;
}

function DateChip({ day }: { day: string }) {
  return (
    <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md bg-muted leading-none">
      <span className="eyebrow text-muted-foreground">{MONTH_SHORT.format(civilDate(day))}</span>
      <span className="mt-0.5 body-sm font-semibold">{Number(day.slice(8, 10))}</span>
    </span>
  );
}
